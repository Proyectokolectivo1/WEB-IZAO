/**
 * Productor BullMQ de la cola `whatsapp` (SOLO SERVIDOR). Id fijo por evento: una reentrega no crea otro job; si el
 * anterior quedó fallido, se reintenta. El worker lee el evento de `webhook_events` por su `event_id`.
 */
import 'server-only';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_WHATSAPP, JOB_WA_EVENTO, jobIdWaEvento, type DatosJobWaEvento } from '@izao/whatsapp';

let cola: Queue | null = null;

function obtenerCola(): Queue {
  if (cola) return cola;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  cola = new Queue(COLA_WHATSAPP, { connection: new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 }) });
  return cola;
}

export async function encolarEventoWhatsApp(eventId: string): Promise<void> {
  const q = obtenerCola();
  const jobId = jobIdWaEvento(eventId);
  const previo = await q.getJob(jobId);
  if (previo && (await previo.isFailed())) {
    await previo.retry();
    return;
  }
  const datos: DatosJobWaEvento = { event_id: eventId };
  await q.add(JOB_WA_EVENTO, datos, {
    jobId,
    attempts: 6,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  });
}
