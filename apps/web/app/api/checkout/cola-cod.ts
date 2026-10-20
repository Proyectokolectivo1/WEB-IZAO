/**
 * Productor BullMQ de la cola `contraentrega` (SOLO SERVIDOR, D-025). Id fijo por pedido: un reintento del checkout
 * no crea otro job; si el anterior falló, se reintenta.
 */
import 'server-only';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_COD, JOB_COD_INICIAR, jobIdCodIniciar, type DatosJobCodIniciar } from '@izao/whatsapp';

let cola: Queue | null = null;

function obtenerCola(): Queue {
  if (cola) return cola;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  cola = new Queue(COLA_COD, { connection: new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 }) });
  return cola;
}

export async function encolarInicioCod(orderId: string): Promise<void> {
  const q = obtenerCola();
  const jobId = jobIdCodIniciar(orderId);
  const previo = await q.getJob(jobId);
  if (previo && (await previo.isFailed())) {
    await previo.retry();
    return;
  }
  const datos: DatosJobCodIniciar = { order_id: orderId };
  await q.add(JOB_COD_INICIAR, datos, {
    jobId,
    attempts: 8,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  });
}
