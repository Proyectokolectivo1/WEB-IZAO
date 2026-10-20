/**
 * Productor BullMQ de la cola `pagos` (SOLO SERVIDOR). Id de job fijo por evento: una reentrega del mismo
 * evento no crea otro job; si el anterior quedó fallido, se reintenta.
 */
import 'server-only';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_PAGOS, JOB_WOMPI_TRANSACCION, jobIdWompi, type DatosJobWompi } from '@izao/wompi';

let cola: Queue | null = null;

function obtenerCola(): Queue {
  if (cola) return cola;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  const conexion = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 });
  cola = new Queue(COLA_PAGOS, { connection: conexion });
  return cola;
}

export async function encolarJobWompi(datos: DatosJobWompi): Promise<void> {
  const q = obtenerCola();
  const jobId = jobIdWompi(datos.event_id);
  const previo = await q.getJob(jobId);
  if (previo && (await previo.isFailed())) {
    await previo.retry();
    return;
  }
  await q.add(JOB_WOMPI_TRANSACCION, datos, {
    jobId,
    attempts: 8,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  });
}
