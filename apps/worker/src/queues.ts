import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { COLA_COD, COLA_WHATSAPP } from '@izao/whatsapp';
import { COLA_CARRIER } from '@izao/mastershop';
import { COLA_PAGOS } from '@izao/wompi';
import { JOB_PURGAR_AUDIT_LOG, purgarAuditLog } from './jobs/purgar-audit-log.js';

/** Conexión compartida; BullMQ exige `maxRetriesPerRequest: null` en workers. */
export function createConnection(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error('REDIS_URL no está definida');
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** Nombres de colas. Los dueños de cada integración agregan las suyas aquí. */
export const QUEUE_NAMES = {
  sistema: 'sistema',
  pagos: COLA_PAGOS,
  contraentrega: COLA_COD,
  whatsapp: COLA_WHATSAPP,
  carrier: COLA_CARRIER,
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export function createQueue(name: QueueName, connection: Redis): Queue {
  return new Queue(name, { connection, defaultJobOptions });
}

/** Manejadores adicionales de la cola de sistema, por nombre de job. */
export type ManejadoresSistema = Record<string, Processor>;

/** Procesador de la cola de sistema: cada job es idempotente. */
export function crearProcesadorSistema(extra: ManejadoresSistema = {}): Processor {
  return async (job, token) => {
    switch (job.name) {
      case JOB_PURGAR_AUDIT_LOG: {
        const borrados = await purgarAuditLog();
        console.log(`[worker] purgar_audit_log: ${borrados} eventos borrados`);
        return { ok: true, job: job.name, borrados };
      }
      default: {
        const manejador = extra[job.name];
        if (manejador) return manejador(job, token);
        return { ok: true, job: job.name };
      }
    }
  };
}

export const procesarSistema: Processor = crearProcesadorSistema();

export function createWorker(name: QueueName, processor: Processor, connection: Redis): Worker {
  return new Worker(name, processor, { connection, concurrency: 5 });
}
