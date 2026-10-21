import 'server-only';
/**
 * Productor de la cola `contraentrega` para el reenvío del cobro desde el panel (D-025). Usa el mismo nombre de
 * job y la misma clave de idempotencia que el checkout (`cod.iniciar.{pedido}`): el worker ya sabe procesarlo y
 * no duplica el link ni el mensaje de un mismo envío.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_COD, JOB_COD_INICIAR, jobIdCodIniciar, type DatosJobCodIniciar } from '@izao/whatsapp';
import type { ResultadoEncolado } from './cobro';

export interface JobCobro {
  isFailed(): Promise<boolean>;
  isCompleted(): Promise<boolean>;
  retry(): Promise<unknown>;
}
export interface ColaCobro {
  getJob(id: string): Promise<JobCobro | undefined | null>;
  add(nombre: string, datos: DatosJobCodIniciar, opciones: Record<string, unknown>): Promise<unknown>;
}

let cola: Queue | null = null;

function colaDesdeEnv(): ColaCobro {
  if (cola) return cola as unknown as ColaCobro;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  cola = new Queue(COLA_COD, { connection: new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 }) });
  return cola as unknown as ColaCobro;
}

export async function encolarCobro(orderId: string, q: ColaCobro = colaDesdeEnv()): Promise<ResultadoEncolado> {
  const jobId = jobIdCodIniciar(orderId);
  const previo = await q.getJob(jobId);
  if (previo) {
    if (await previo.isFailed()) {
      await previo.retry();
      return 'reintentado';
    }
    return (await previo.isCompleted()) ? 'ya_procesado' : 'en_curso';
  }
  await q.add(
    JOB_COD_INICIAR,
    { order_id: orderId },
    {
      jobId,
      attempts: 8,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  );
  return 'encolado';
}
