/**
 * Cola `pagos` del worker (dueño: izao-pagos). El arranque (`queues.ts`/`index.ts`, de izao-infra) debe:
 *   createWorker(COLA_PAGOS, crearProcesadorPagos(dependenciasPagosDesdeEnv(encolarTransportadora,
 *     (id) => cancelarJobsCod(colaCod, id))), conexión)   // cancelarJobsCod de ./jobs/cod
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY.
 */
import type { Processor } from 'bullmq';
import { COLA_PAGOS, JOB_WOMPI_TRANSACCION, crearClienteWompi, type DatosJobWompi } from '@izao/wompi';
import { crearFuentePostgrest } from './fuente-postgrest.js';
import { procesarTransaccionWompi, type DepsJobWompi } from './wompi-transaccion.js';

export { COLA_PAGOS, JOB_WOMPI_TRANSACCION };
export { ErrorReintentable, procesarTransaccionWompi } from './wompi-transaccion.js';

function datosValidos(d: unknown): d is DatosJobWompi {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  return typeof r.event_id === 'string' && r.event_id !== '' && typeof r.transaction_id === 'string' && r.transaction_id !== '';
}

export function crearProcesadorPagos(deps: DepsJobWompi): Processor {
  return async (job) => {
    if (job.name !== JOB_WOMPI_TRANSACCION) return { ok: true, ignorado: job.name };
    if (!datosValidos(job.data)) return { ok: false, motivo: 'datos_invalidos' };
    const r = await procesarTransaccionWompi(job.data, deps);
    console.log(`[worker] ${JOB_WOMPI_TRANSACCION}: ${r.accion}`);
    return r;
  };
}

export function dependenciasPagosDesdeEnv(
  encolarTransportadora: (orderId: string) => Promise<void>,
  /** Optimización: sin ella los jobs de contra entrega igual se omiten al releer el estado. */
  cancelarJobsCod: (orderId: string) => Promise<void> = async () => {},
): DepsJobWompi {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para la cola de pagos');
  }
  return {
    fuente: crearFuentePostgrest({ supabaseUrl, secretKey, claveCifrado }),
    cliente: (c) => crearClienteWompi({ ambiente: c.ambiente, llavePrivada: c.llavePrivada }),
    encolarTransportadora,
    cancelarJobsCod,
  };
}
