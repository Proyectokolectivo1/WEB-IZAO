/**
 * Aprobación de un pago completo (Wompi `full` o financiación Addi/Sistecrédito) compartida por los jobs de la
 * cola `pagos`. Un solo lugar decide qué pasa con el pedido cuando llega un aprobado:
 * - `pendiente_pago` / `pago_rechazado` → confirma stock → (`pago_rechazado → pendiente_pago`) → `pagado` →
 *   confirma canje y encola la transportadora.
 * - `pagado` (reentrega o reintento tras falla parcial) → repite los pasos idempotentes.
 * - `expirado` → `requiere_reembolso` con alerta `pago_tardio` (no se despacha).
 * - Otro pago aprobado del mismo propósito → alerta `pago_duplicado`, sin transición.
 * Las transiciones las hace `paso` del job (siempre `transicionar` + `aplicarTransicion` condicional).
 */
import type { OrderStatus } from '@izao/core/order-state';
import type { FuentePagosWorker, PagoFila, PedidoFila } from './fuente.js';

export class ErrorReintentable extends Error {
  constructor(motivo: string, job = 'wompi.transaccion') {
    super(`${job}: ${motivo}`);
    this.name = 'ErrorReintentable';
  }
}

export type AccionPago =
  | 'pagado'
  | 'abono_pagado'
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
  | 'solicitud_distinta'
  | 'estado_inesperado';

export interface ResultadoJob {
  accion: AccionPago;
  order_id: string | null;
}

export type Paso = (from: OrderStatus, to: OrderStatus, extra?: { paid_at?: Date }) => Promise<void>;
export type Terminar = (accion: AccionPago, orderId: string | null, ok: boolean) => Promise<ResultadoJob>;

export interface DepsAprobacion {
  fuente: Pick<FuentePagosWorker, 'pagosDelPedido' | 'confirmarStock' | 'confirmarCanje' | 'registrarAlerta'>;
  /** Encola `carrier.create` (idempotente por pedido). */
  encolarTransportadora: (orderId: string) => Promise<void>;
}

/** Estados posteriores al pago: el pedido ya avanzó y no hay nada que hacer. */
export const DESPUES_DEL_PAGO: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'enviado_transportadora',
  'error_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
]);

/** `true` si ya hay otro pago aprobado del mismo propósito (se alerta y no se transiciona). */
export async function duplicado(
  deps: DepsAprobacion,
  pedido: PedidoFila,
  pago: PagoFila,
  ref: Record<string, string>,
): Promise<boolean> {
  const pagos = await deps.fuente.pagosDelPedido(pedido.id);
  if (!pagos.some((p) => p.id !== pago.id && p.purpose === pago.purpose && p.status === 'approved')) return false;
  await deps.fuente.registrarAlerta(pedido.id, 'pago_duplicado', ref);
  return true;
}

/** Canje confirmado y transportadora encolada: idempotentes, se repiten en cada reentrega. */
export async function despuesDePagar(deps: DepsAprobacion, pedido: PedidoFila, ref: Record<string, string>): Promise<void> {
  const canje = await deps.fuente.confirmarCanje(pedido.id);
  if (canje.ok && canje.advertencia === 'limite_superado') {
    await deps.fuente.registrarAlerta(pedido.id, 'limite_canje_superado', ref);
  }
  await deps.encolarTransportadora(pedido.id);
}

export async function aprobarPagoCompleto(
  deps: DepsAprobacion,
  pedido: PedidoFila,
  pago: PagoFila,
  ref: Record<string, string>,
  paso: Paso,
  terminar: Terminar,
  ahora: Date,
): Promise<ResultadoJob> {
  const { fuente } = deps;
  if (await duplicado(deps, pedido, pago, ref)) return terminar('pago_duplicado', pedido.id, false);

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
      await despuesDePagar(deps, pedido, ref);
      return terminar('pagado', pedido.id, true);
    }
    case 'pagado': {
      // Reentrega o reintento tras una falla parcial: los pasos siguientes son idempotentes.
      const stock = await fuente.confirmarStock(pedido.id);
      if (!stock.ok) {
        await fuente.registrarAlerta(pedido.id, 'sin_stock_al_aprobar', ref);
        return terminar('sin_stock', pedido.id, false);
      }
      await despuesDePagar(deps, pedido, ref);
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
