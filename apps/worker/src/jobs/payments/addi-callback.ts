/**
 * Job `addi.callback` (cola `pagos`, §12.3, D-031). Lo encola `POST /api/webhooks/addi` después de verificar la
 * autenticación Basic y registrar el evento. Addi no documenta consulta de estado para e-commerce: el callback
 * autenticado es la confirmación, así que aquí se exige que todo cuadre con lo que el servidor guardó:
 * 1. Asocia por `orderId` = `payments.provider_reference` (`IZ-CO-000123-A1`, provider `addi`, purpose `financing`).
 * 2. El pedido debe ser de Addi; si el pago ya tiene otra `applicationId`, alerta y no aprueba.
 * 3. APPROVED: `approvedAmount` en COP sin centavos igual a `payments.amount` (= `total_customer`, con recargo).
 * 4. Actualiza `payments` (nunca degrada un `approved` ni reabre un rechazo con un PENDING tardío) con la comisión
 *    estimada de `payment_method_settings` del método `addi`.
 * 5. Aprobado → misma lógica que el pago completo de Wompi (`aprobarPagoCompleto`). Rechazado, desistido,
 *    abandonado o error del último intento → `pago_rechazado` (la página de estado ofrece otros métodos).
 * Idempotente: repetir el mismo callback no duplica transiciones ni eventos.
 */
import { transicionar, type JsonValue, type OrderStatus } from '@izao/core/order-state';
import { comisionPasarela } from '@izao/core/pricing';
import { estadoCallbackAddi, type DatosJobAddi } from '@izao/addi';
import {
  ErrorReintentable,
  aprobarPagoCompleto,
  type AccionPago,
  type ResultadoJob,
} from './aprobacion.js';
import type { FuenteFinanciacionWorker } from './fuente.js';

export interface DepsJobAddi {
  fuente: FuenteFinanciacionWorker;
  /** Encola `carrier.create` (idempotente por pedido). */
  encolarTransportadora: (orderId: string) => Promise<void>;
  ahora?: () => Date;
}

const ACTOR = 'webhook:addi';
const JOB = 'addi.callback';
const FINALES_NO_APROBADOS = new Set(['declined', 'voided', 'error', 'expired']);

export async function procesarCallbackAddi(datos: DatosJobAddi, deps: DepsJobAddi): Promise<ResultadoJob> {
  const { fuente } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const cb = datos.callback;
  const st = estadoCallbackAddi(cb);

  const terminar = async (accion: AccionPago, orderId: string | null, ok: boolean): Promise<ResultadoJob> => {
    await fuente.marcarWebhook(datos.event_id, ok ? { ok: true } : { ok: false, error: accion });
    return { accion, order_id: orderId };
  };

  const [pago] = await fuente.pagosPorReferencia(cb.orderId);
  if (!pago) return terminar('pago_no_encontrado', null, false);
  if (pago.purpose !== 'financing') return terminar('proposito_no_soportado', pago.order_id, false);

  const pedido = await fuente.pedido(pago.order_id);
  if (!pedido) return terminar('pedido_no_encontrado', pago.order_id, false);

  const ref = { payment_id: pago.id, reference: cb.orderId, application_id: cb.applicationId };
  if (pedido.payment_method !== 'addi') {
    await fuente.registrarAlerta(pedido.id, 'proposito_no_coincide', { ...ref, metodo: pedido.payment_method });
    return terminar('estado_inesperado', pedido.id, false);
  }
  if (pago.provider_transaction_id !== null && pago.provider_transaction_id !== cb.applicationId) {
    await fuente.registrarAlerta(pedido.id, 'solicitud_distinta', { ...ref, guardada: pago.provider_transaction_id });
    return terminar('solicitud_distinta', pedido.id, false);
  }
  if (st.status === 'approved' && (st.amount !== pago.amount || st.currency_code !== pago.currency_code)) {
    await fuente.registrarAlerta(pedido.id, 'monto_no_coincide', {
      ...ref,
      esperado: pago.amount.toString(),
      recibido: cb.approvedAmount.slice(0, 30),
      moneda: cb.currency.slice(0, 8),
    });
    return terminar('monto_no_coincide', pedido.id, false);
  }

  if (pago.status === 'approved' && st.status !== 'approved') {
    // Un aprobado no se degrada: lo revisa el admin.
    await fuente.registrarAlerta(pedido.id, `aprobado_luego_${st.status}`, ref);
    return terminar('sin_cambio', pedido.id, true);
  }
  if (FINALES_NO_APROBADOS.has(pago.status) && st.status === 'pending') {
    // PENDING que llega después de un estado final (reintentos de Addi fuera de orden).
    return terminar('sin_cambio', pedido.id, true);
  }
  if (pago.status !== st.status || pago.provider_transaction_id !== cb.applicationId) {
    let fee: bigint | null = null;
    if (st.status === 'approved') {
      const cfg = await fuente.comision(pedido.country_code, 'addi');
      fee = cfg ? comisionPasarela(pago.amount, cfg) : null;
    }
    await fuente.actualizarPago(pago.id, {
      status: st.status,
      provider_transaction_id: cb.applicationId,
      fee_amount: fee,
      raw_last_event: st.raw,
    });
  }

  const paso = async (from: OrderStatus, to: OrderStatus, extra: { paid_at?: Date } = {}): Promise<void> => {
    const r = transicionar({ from, to, actor: ACTOR, payload: ref as Record<string, JsonValue> });
    if (!r.ok) throw new Error(`Transición inválida ${from} → ${to}: ${r.error.code}`);
    const aplicada = await fuente.aplicarTransicion(pedido.id, r.event, extra);
    if (!aplicada) throw new ErrorReintentable('conflicto_estado', JOB);
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
      const ultimo = pagos.filter((p) => p.purpose === 'financing').at(-1);
      if (pedido.status === 'pendiente_pago' && ultimo?.id === pago.id) {
        await paso('pendiente_pago', 'pago_rechazado');
        return terminar('pago_rechazado', pedido.id, true);
      }
      return terminar('sin_cambio', pedido.id, true);
    }
    case 'approved':
      return aprobarPagoCompleto(deps, pedido, pago, ref, paso, terminar, ahora());
  }
}
