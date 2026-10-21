import 'server-only';
/**
 * Productor de la cola `contraentrega` para el reenvío del cobro desde el panel (D-025): job `cod.reenviar`.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_COD, JOB_COD_REENVIAR, jobIdCodReenviar, type DatosJobCodReenviar } from '@izao/whatsapp';
import type { ResultadoEncolado } from './cobro';

export interface ColaCobro {
  add(nombre: string, datos: DatosJobCodReenviar, opciones: Record<string, unknown>): Promise<unknown>;
}

let cola: Queue | null = null;

function colaDesdeEnv(): ColaCobro {
  if (cola) return cola as unknown as ColaCobro;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  cola = new Queue(COLA_COD, { connection: new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 }) });
  return cola as unknown as ColaCobro;
}

/**
 * Encola un reenvío. Cada solicitud tiene su propio jobId (pedido + instante), así que un segundo reenvío es un
 * job nuevo; repetir el mismo job (reintento de BullMQ) no duplica el mensaje porque el instante es su `scheduled_for`.
 * El tope de reenvíos por pedido (`cod_resend_max`) lo aplica el worker.
 */
export async function encolarCobro(
  orderId: string,
  q: ColaCobro = colaDesdeEnv(),
  ahora: () => Date = () => new Date(),
): Promise<ResultadoEncolado> {
  const solicitado = ahora();
  await q.add(
    JOB_COD_REENVIAR,
    { order_id: orderId, solicitado_en: solicitado.toISOString() },
    {
      jobId: jobIdCodReenviar(orderId, solicitado),
      attempts: 8,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  );
  return 'encolado';
}
