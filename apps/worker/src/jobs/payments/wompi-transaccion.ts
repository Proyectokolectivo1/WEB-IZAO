/**
 * Job `wompi.transaccion` (cola `pagos`, §12.2). Lo encola el webhook ya verificado; aquí:
 * 1. Reconsulta `GET /v1/transactions/{id}` con la llave privada: nunca se confía en el cuerpo del webhook.
 * 2. Asocia por `reference` (pago completo) o `payment_link_id` (abono).
 * 3. Compara monto y moneda con `payments`; si no coinciden, no aprueba y alerta.
 * 4. Actualiza `payments` (nunca degrada un `approved`) con la comisión estimada.
 * 5. Transiciona el pedido solo con `transicionar` y `aplicarTransicion` condicional al estado leído.
 *
 * Idempotente: repetirlo con el mismo evento no duplica transiciones ni eventos; confirmar stock y canje son
 * idempotentes en la base y el job de transportadora usa id fijo. Un `ErrorReintentable` deja que BullMQ reintente.
 */
import { transicionar, type JsonValue, type OrderStatus } from '@izao/core/order-state';
import { comisionPasarela } from '@izao/core/pricing';
import {
  ErrorWompi,
  estadoProveedor,
  type ClienteWompi,
  type DatosJobWompi,
  type TransaccionWompi,
  type WompiCredentials,
} from '@izao/wompi';
import type { FuentePagosWorker, PagoFila, PedidoFila } from './fuente.js';

export class ErrorReintentable extends Error {
  constructor(motivo: string) {
    super(`wompi.transaccion: ${motivo}`);
    this.name = 'ErrorReintentable';
  }
}

export type AccionPago =
  | 'pagado'
  | 'ya_pagado'
  | 'pago_rechazado'
  | 'sin_cambio'
  | 'requiere_reembolso'
  | 'pago_duplicado'
  | 'sin_stock'
  | 'monto_no_coincide'
  | 'pago_no_encontrado'
  | 'pedido_no_encontrado'
  | 'transaccion_inexistente'
  | 'proposito_no_soportado'
  | 'estado_inesperado';

export interface DepsJobWompi {
  fuente: FuentePagosWorker;
  cliente: (c: WompiCredentials) => ClienteWompi;
  /** Encola `carrier.create` (idempotente por pedido). */
  encolarTransportadora: (orderId: string) => Promise<void>;
  ahora?: () => Date;
}

export interface ResultadoJob {
  accion: AccionPago;
  order_id: string | null;
}

/** Estados posteriores al pago: el pedido ya avanzó y no hay nada que hacer. */
const DESPUES_DEL_PAGO: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'enviado_transportadora',
  'error_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
]);

const ACTOR = 'webhook:wompi';

async function consultar(deps: DepsJobWompi, creds: WompiCredentials, id: string): Promise<TransaccionWompi | null> {
  try {
    return await deps.cliente(creds).obtenerTransaccion(id);
  } catch (e) {
    if (e instanceof ErrorWompi && (e.codigo === 'NO_ENCONTRADA' || e.codigo === 'ID_INVALIDO')) return null;
    // Red, 5xx, credenciales mal configuradas o respuesta rara: se reintenta (el admin puede corregir).
    throw new ErrorReintentable(e instanceof ErrorWompi ? e.codigo : 'consulta');
  }
}

export async function procesarTransaccionWompi(datos: DatosJobWompi, deps: DepsJobWompi): Promise<ResultadoJob> {
  const { fuente } = deps;
  const ahora = deps.ahora ?? (() => new Date());

  const creds = await fuente.credencialesWompi();
  if (!creds) throw new ErrorReintentable('sin_credenciales');

  const terminar = async (accion: AccionPago, orderId: string | null, ok: boolean): Promise<ResultadoJob> => {
    await fuente.marcarWebhook(datos.event_id, ok ? { ok: true } : { ok: false, error: accion });
    return { accion, order_id: orderId };
  };

  const tx = await consultar(deps, creds, datos.transaction_id);
  if (!tx) return terminar('transaccion_inexistente', null, false);
  const st = estadoProveedor(tx);

  let candidatos = await fuente.pagosPorReferencia(tx.reference);
  if (candidatos.length === 0 && tx.payment_link_id) candidatos = await fuente.pagosPorLink(tx.payment_link_id);
  // Con varias filas de la misma referencia (carrera al crear el intento) se usa la más antigua: mismo pedido y monto.
  const pago = candidatos[0];
  if (!pago) return terminar('pago_no_encontrado', null, false);
  // El abono de contra entrega y la financiación tienen su propio flujo (pendiente): se deja sin procesar.
  if (pago.purpose !== 'full') return terminar('proposito_no_soportado', pago.order_id, false);

  const pedido = await fuente.pedido(pago.order_id);
  if (!pedido) return terminar('pedido_no_encontrado', pago.order_id, false);

  const ref = { payment_id: pago.id, reference: tx.reference, transaction_id: tx.id };
  if (st.amount !== pago.amount || st.currency_code !== pago.currency_code) {
    await fuente.registrarAlerta(pedido.id, 'monto_no_coincide', {
      ...ref,
      esperado: pago.amount.toString(),
      recibido_centavos: tx.amount_in_cents.toString(),
      moneda: tx.currency,
    });
    return terminar('monto_no_coincide', pedido.id, false);
  }

  if (pago.status === 'approved' && st.status !== 'approved') {
    // Un aprobado no se degrada (p. ej. VOIDED después de APPROVED): lo revisa el admin.
    await fuente.registrarAlerta(pedido.id, `aprobado_luego_${st.status}`, ref);
    return terminar('sin_cambio', pedido.id, true);
  }
  if (pago.status !== st.status || pago.provider_transaction_id !== tx.id) {
    let fee: bigint | null = null;
    if (st.status === 'approved') {
      const cfg = await fuente.comision(pedido.country_code, 'wompi');
      fee = cfg ? comisionPasarela(pago.amount, cfg) : null;
    }
    await fuente.actualizarPago(pago.id, {
      status: st.status,
      provider_transaction_id: tx.id,
      fee_amount: fee,
      raw_last_event: st.raw,
    });
  }

  const paso = async (from: OrderStatus, to: OrderStatus, extra: { paid_at?: Date } = {}): Promise<void> => {
    const r = transicionar({ from, to, actor: ACTOR, payload: ref as Record<string, JsonValue> });
    if (!r.ok) throw new Error(`Transición inválida ${from} → ${to}: ${r.error.code}`);
    const aplicada = await fuente.aplicarTransicion(pedido.id, r.event, extra);
    if (!aplicada) throw new ErrorReintentable('conflicto_estado');
  };

  switch (st.status) {
    case 'pending':
    case 'created':
      return terminar('sin_cambio', pedido.id, true);
    case 'declined':
    case 'voided':
    case 'error':
    case 'expired': {
      const pagos = await fuente.pagosDelPedido(pedido.id);
      const ultimo = pagos.filter((p) => p.purpose === 'full').at(-1);
      if (pedido.status === 'pendiente_pago' && ultimo?.id === pago.id) {
        await paso('pendiente_pago', 'pago_rechazado');
        return terminar('pago_rechazado', pedido.id, true);
      }
      return terminar('sin_cambio', pedido.id, true);
    }
    case 'approved':
      return aprobar(deps, pedido, pago, ref, paso, terminar, ahora());
  }
}

async function aprobar(
  deps: DepsJobWompi,
  pedido: PedidoFila,
  pago: PagoFila,
  ref: Record<string, string>,
  paso: (from: OrderStatus, to: OrderStatus, extra?: { paid_at?: Date }) => Promise<void>,
  terminar: (accion: AccionPago, orderId: string | null, ok: boolean) => Promise<ResultadoJob>,
  ahora: Date,
): Promise<ResultadoJob> {
  const { fuente } = deps;
  const pagos = await fuente.pagosDelPedido(pedido.id);
  if (pagos.some((p) => p.id !== pago.id && p.status === 'approved')) {
    await fuente.registrarAlerta(pedido.id, 'pago_duplicado', ref);
    return terminar('pago_duplicado', pedido.id, false);
  }

  const despuesDePagar = async (): Promise<void> => {
    const canje = await fuente.confirmarCanje(pedido.id);
    if (canje.ok && canje.advertencia === 'limite_superado') {
      await fuente.registrarAlerta(pedido.id, 'limite_canje_superado', ref);
    }
    await deps.encolarTransportadora(pedido.id);
  };

  switch (pedido.status) {
    case 'pendiente_pago':
    case 'pago_rechazado': {
      const stock = await fuente.confirmarStock(pedido.id);
      if (!stock.ok) {
        await fuente.registrarAlerta(pedido.id, 'sin_stock_al_aprobar', ref);
        return terminar('sin_stock', pedido.id, false);
      }
      if (pedido.status === 'pago_rechazado') await paso('pago_rechazado', 'pendiente_pago');
      await paso('pendiente_pago', 'pagado', { paid_at: ahora });
      await despuesDePagar();
      return terminar('pagado', pedido.id, true);
    }
    case 'pagado': {
      // Reentrega o reintento tras una falla parcial: los pasos siguientes son idempotentes.
      const stock = await fuente.confirmarStock(pedido.id);
      if (!stock.ok) {
        await fuente.registrarAlerta(pedido.id, 'sin_stock_al_aprobar', ref);
        return terminar('sin_stock', pedido.id, false);
      }
      await despuesDePagar();
      return terminar('ya_pagado', pedido.id, true);
    }
    case 'expirado':
      await paso('expirado', 'requiere_reembolso');
      await fuente.registrarAlerta(pedido.id, 'pago_tardio', ref);
      return terminar('requiere_reembolso', pedido.id, true);
    case 'requiere_reembolso':
      return terminar('sin_cambio', pedido.id, true);
    default:
      if (DESPUES_DEL_PAGO.has(pedido.status)) return terminar('ya_pagado', pedido.id, true);
      await fuente.registrarAlerta(pedido.id, 'pago_en_estado_inesperado', { ...ref, estado: pedido.status });
      return terminar('estado_inesperado', pedido.id, false);
  }
}
