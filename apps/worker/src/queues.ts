import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { JOB_PURGAR_AUDIT_LOG, purgarAuditLog } from './jobs/purgar-audit-log.js';

/** Conexión compartida; BullMQ exige `maxRetriesPerRequest: null` en workers. */
export function createConnection(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error('REDIS_URL no está definida');
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** Nombres de colas. Los dueños de cada integración agregan las suyas aquí. */
export const QUEUE_NAMES = {
  sistema: 'sistema',
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

/** Procesador de la cola de sistema: cada job es idempotente. */
export const procesarSistema: Processor = async (job) => {
  switch (job.name) {
    case JOB_PURGAR_AUDIT_LOG: {
      const borrados = await purgarAuditLog();
      console.log(`[worker] purgar_audit_log: ${borrados} eventos borrados`);
      return { ok: true, job: job.name, borrados };
    }
    default:
      return { ok: true, job: job.name };
  }
};

export function createWorker(name: QueueName, processor: Processor, connection: Redis): Worker {
  return new Worker(name, processor, { connection, concurrency: 5 });
}
