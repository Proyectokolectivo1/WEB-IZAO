import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

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

/** Procesador de ejemplo: idempotente y sin efectos. */
export const procesarSistema: Processor = async (job) => {
  return { ok: true, job: job.name };
};

export function createWorker(name: QueueName, processor: Processor, connection: Redis): Worker {
  return new Worker(name, processor, { connection, concurrency: 5 });
}
