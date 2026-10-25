/**
 * Cola `pagos` del worker (dueño: izao-pagos). Jobs: `wompi.transaccion` y `addi.callback`. El arranque
 * (`queues.ts`/`index.ts`, de izao-infra) debe:
 *   createWorker(COLA_PAGOS, crearProcesadorPagos(dependenciasPagosDesdeEnv(encolarTransportadora,
 *     (id) => cancelarJobsCod(colaCod, id), recalculadorMetricasDesdeEnv(colaSistema))), conexión)
 * (`cancelarJobsCod` de ./jobs/cod; `recalculadorMetricasDesdeEnv` de ./jobs/metrics/tras-transicion).
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY.
 */
import type { Processor } from 'bullmq';
import { ESTADOS_ADDI, JOB_ADDI_CALLBACK, type DatosJobAddi } from '@izao/addi';
import { COLA_PAGOS, JOB_WOMPI_TRANSACCION, crearClienteWompi, type DatosJobWompi } from '@izao/wompi';
import { conRecalculoMetricas, type RecalcularMetricasPedido } from '../metrics/tras-transicion.js';
import { procesarCallbackAddi, type DepsJobAddi } from './addi-callback.js';
import { crearFuenteAddiPostgrest, crearFuentePostgrest } from './fuente-postgrest.js';
import { procesarTransaccionWompi, type DepsJobWompi } from './wompi-transaccion.js';

export { COLA_PAGOS, JOB_ADDI_CALLBACK, JOB_WOMPI_TRANSACCION };
export { ErrorReintentable, procesarTransaccionWompi } from './wompi-transaccion.js';
export { procesarCallbackAddi } from './addi-callback.js';

export type DepsPagos = DepsJobWompi & { addi?: DepsJobAddi };

function datosValidos(d: unknown): d is DatosJobWompi {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  return typeof r.event_id === 'string' && r.event_id !== '' && typeof r.transaction_id === 'string' && r.transaction_id !== '';
}

const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v !== '' && v.length <= max;

/** El webhook ya validó el callback; aquí solo se revisa la forma por si el job llegó de otro lado. */
function datosAddiValidos(d: unknown): d is DatosJobAddi {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  const c = r.callback as Record<string, unknown> | null | undefined;
  return (
    texto(r.event_id, 300) &&
    typeof c === 'object' &&
    c !== null &&
    texto(c.orderId, 60) &&
    texto(c.applicationId, 100) &&
    texto(c.approvedAmount, 30) &&
    texto(c.currency, 8) &&
    texto(c.statusTimestamp, 13) &&
    (ESTADOS_ADDI as readonly unknown[]).includes(c.status)
  );
}

export function crearProcesadorPagos(deps: DepsPagos): Processor {
  return async (job) => {
    if (job.name === JOB_ADDI_CALLBACK) {
      // Sin dependencias de Addi se lanza (BullMQ reintenta): un callback nunca se descarta en silencio.
      if (!deps.addi) throw new Error(`${JOB_ADDI_CALLBACK}: el worker no tiene dependencias de Addi`);
      if (!datosAddiValidos(job.data)) return { ok: false, motivo: 'datos_invalidos' };
      const r = await procesarCallbackAddi(job.data, deps.addi);
      console.log(`[worker] ${JOB_ADDI_CALLBACK}: ${r.accion}`);
      return r;
    }
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
  /** Encola `metrics.recompute_day` tras cada transición aplicada (sin él, solo corrige el nocturno). */
  recalcularMetricas?: RecalcularMetricasPedido,
): DepsPagos {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para la cola de pagos');
  }
  const o = { supabaseUrl, secretKey, claveCifrado };
  return {
    fuente: conRecalculoMetricas(crearFuentePostgrest(o), recalcularMetricas),
    cliente: (c) => crearClienteWompi({ ambiente: c.ambiente, llavePrivada: c.llavePrivada }),
    encolarTransportadora,
    cancelarJobsCod,
    addi: { fuente: conRecalculoMetricas(crearFuenteAddiPostgrest(o), recalcularMetricas), encolarTransportadora },
  };
}
