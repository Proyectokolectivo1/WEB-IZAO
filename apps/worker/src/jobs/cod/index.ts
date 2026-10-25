/**
 * Cola `contraentrega` del worker (dueño: izao-pagos, D-025). El arranque (izao-infra) debe:
 *   const cola = new Queue(COLA_COD, { connection });
 *   createWorker(COLA_COD, crearProcesadorCod(deps(programadorCod(cola))), connection)
 * y pasar `cancelarJobsCod(cola, …)` a las dependencias del job de pagos.
 * La cancelación es una optimización: cada job relee el estado del pedido y no hace nada si ya se pagó.
 */
import { DelayedError, type Job, type Processor, type Queue } from 'bullmq';
import {
  COLA_COD,
  crearClienteWhatsApp,
  JOB_COD_ABANDONO,
  JOB_COD_INICIAR,
  JOB_COD_RECORDATORIO,
  JOB_COD_REENVIAR,
  jobIdCodAbandono,
  jobIdCodRecordatorio,
} from '@izao/whatsapp';
import { crearLinkPago } from '@izao/wompi';
import { abandonarCod, iniciarCod, recordatorioCod, reenviarCod, type DepsCod, type JobProgramado } from './flujo.js';
import { crearFuenteCodPostgrest } from './fuente-postgrest.js';
import { conRecalculoMetricas, type RecalcularMetricasPedido } from '../metrics/tras-transicion.js';

export { COLA_COD };

/** Respaldo por correo del cobro. No hay proveedor de correo definido: el arranque lo pasa cuando exista. */
export type CorreoRespaldo = NonNullable<DepsCod['correoRespaldo']>;

/** Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY, SITE_URL (origen https). */
export function dependenciasCodDesdeEnv(
  programar: DepsCod['programar'],
  correoRespaldo?: CorreoRespaldo,
  /** Encola `metrics.recompute_day` tras cada transición aplicada (abandono). */
  recalcularMetricas?: RecalcularMetricasPedido,
): DepsCod {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  const urlSitio = process.env.SITE_URL;
  if (!supabaseUrl || !secretKey || !claveCifrado || !urlSitio) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY o SITE_URL para la cola de contra entrega');
  }
  return {
    fuente: conRecalculoMetricas(crearFuenteCodPostgrest({ supabaseUrl, secretKey, claveCifrado }), recalcularMetricas),
    wompi: (c) => ({ crearLink: (e) => crearLinkPago({ ambiente: c.ambiente, llavePrivada: c.llavePrivada }, e) }),
    whatsapp: (c) => crearClienteWhatsApp(c),
    programar,
    ...(correoRespaldo ? { correoRespaldo } : {}),
    urlSitio,
  };
}
export { ErrorReintentableCod, abandonarCod, iniciarCod, recordatorioCod, reenviarCod } from './flujo.js';

/** Tope de recordatorios que se intentan cancelar por pedido (más que cualquier configuración razonable). */
const MAX_RECORDATORIOS = 24;

const OPCIONES = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function programadorCod(cola: Queue, ahora: () => number = Date.now): DepsCod['programar'] {
  return async (j: JobProgramado) => {
    const delay = Math.max(0, j.en.getTime() - ahora());
    if (j.tipo === 'abandono') {
      await cola.add(JOB_COD_ABANDONO, { order_id: j.order_id }, { ...OPCIONES, jobId: jobIdCodAbandono(j.order_id), delay });
    } else {
      await cola.add(
        JOB_COD_RECORDATORIO,
        { order_id: j.order_id, n: j.n },
        { ...OPCIONES, attempts: 4, jobId: jobIdCodRecordatorio(j.order_id, j.n), delay },
      );
    }
  };
}

export async function cancelarJobsCod(cola: Queue, orderId: string): Promise<void> {
  const ids = [jobIdCodAbandono(orderId)];
  for (let n = 1; n <= MAX_RECORDATORIOS; n += 1) ids.push(jobIdCodRecordatorio(orderId, n));
  // `remove` devuelve 0 si el job no existe o está activo (bloqueado): en ambos casos el job relee el estado.
  await Promise.all(ids.map((id) => cola.remove(id)));
}

function uuid(d: unknown): string | null {
  const v = (d as { order_id?: unknown } | null)?.order_id;
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

export function crearProcesadorCod(deps: DepsCod): Processor {
  return async (job: Job, token?: string) => {
    const orderId = uuid(job.data);
    if (!orderId) return { ok: false, motivo: 'datos_invalidos' };
    let r;
    switch (job.name) {
      case JOB_COD_INICIAR:
        r = await iniciarCod(orderId, deps);
        break;
      case JOB_COD_RECORDATORIO: {
        const n = (job.data as { n?: unknown }).n;
        if (typeof n !== 'number' || !Number.isInteger(n)) return { ok: false, motivo: 'datos_invalidos' };
        r = await recordatorioCod(orderId, n, deps);
        break;
      }
      case JOB_COD_ABANDONO: {
        // Un abandono que corre antes de tiempo se reprograma moviendo ESTE job (el id fijo no admite otro igual).
        let en: Date | null = null;
        r = await abandonarCod(orderId, { ...deps, programar: async (j) => void (en = j.en) });
        if (r.accion === 'reprogramado' && en && token) {
          await job.moveToDelayed((en as Date).getTime(), token);
          throw new DelayedError();
        }
        break;
      }
      case JOB_COD_REENVIAR: {
        const iso = (job.data as { solicitado_en?: unknown }).solicitado_en;
        const solicitado = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(iso) ? new Date(iso) : null;
        if (!solicitado || Number.isNaN(solicitado.getTime())) return { ok: false, motivo: 'datos_invalidos' };
        r = await reenviarCod(orderId, solicitado, deps);
        if (r.accion === 'reprogramado' && r.en && token) {
          await job.moveToDelayed(r.en.getTime(), token);
          throw new DelayedError();
        }
        break;
      }
      default:
        return { ok: true, ignorado: job.name };
    }
    console.log(`[worker] ${job.name}: ${r.accion}`);
    return r;
  };
}
