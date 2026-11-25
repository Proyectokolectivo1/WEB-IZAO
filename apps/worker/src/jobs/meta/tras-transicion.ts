/**
 * Enganche del Purchase de Meta tras cada transición del pedido (§23.2). Los jobs de pagos, contra entrega, carrier y
 * barrido ya llaman a un `RecalcularMetricasPedido(orderId)` cuando una transición queda aplicada
 * (`conRecalculoMetricas`); `combinarTrasTransicion` lo extiende con el encolado de `meta.capi_purchase` sin tocar cada job.
 *
 * Solo se encola cuando el pedido ya tiene `paid_at` (pago completo, financiación o abono): así el `jobId` fijo por pedido
 * nunca bloquea un envío posterior. Si el encolado falla (Redis o la base caídos) se registra y la transición no se
 * deshace: el checkout y los pagos no dependen de Meta.
 */
import type { Queue } from 'bullmq';
import { crearClientePostgrest, eq, type OpcionesPostgrest } from '../postgrest.js';
import { JOB_META_CAPI_PURCHASE, jobIdCapiCompra } from './conversiones.js';

export type TrasTransicion = (orderId: string) => Promise<void>;

/** Ejecuta cada enganche; el fallo de uno no impide a los demás ni a la transición. */
export function combinarTrasTransicion(...enganches: TrasTransicion[]): TrasTransicion {
  return async (orderId) => {
    for (const e of enganches) {
      try {
        await e(orderId);
      } catch (err) {
        console.error(`[meta] enganche tras la transición falló: ${err instanceof Error ? err.name : 'error'}`);
      }
    }
  };
}

export function encolarCapiSiPagado(cola: Pick<Queue, 'add'>, estaPagado: (orderId: string) => Promise<boolean>): TrasTransicion {
  return async (orderId) => {
    if (!(await estaPagado(orderId))) return;
    await cola.add(JOB_META_CAPI_PURCHASE, { order_id: orderId }, { jobId: jobIdCapiCompra(orderId) });
  };
}

export function estaPagadoPostgrest(o: OpcionesPostgrest): (orderId: string) => Promise<boolean> {
  const c = crearClientePostgrest(o);
  return async (orderId) => {
    const [f] = await c.filas('orders', `orders?id=${eq(orderId)}&select=paid_at`);
    return typeof f?.paid_at === 'string';
  };
}

export function encolarCapiDesdeEnv(colaSistema: Queue): TrasTransicion {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para la API de Conversiones');
  }
  return encolarCapiSiPagado(colaSistema, estaPagadoPostgrest({ supabaseUrl, secretKey, claveCifrado }));
}
