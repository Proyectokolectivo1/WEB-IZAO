/**
 * Productor BullMQ de la cola `carrier` (SOLO SERVIDOR). `carrier.sync` con id fijo por evento: una reentrega
 * del mismo evento no crea otro job; si el anterior terminó, se reemplaza.
 */
import 'server-only';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  COLA_CARRIER,
  JOB_CARRIER_SYNC,
  encolarJobCarrier,
  jobIdSync,
  type ColaMinima,
  type DatosJobSync,
} from '@izao/mastershop';

let cola: Queue | null = null;

function obtenerCola(): Queue {
  if (cola) return cola;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL no está definida');
  const conexion = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 });
  cola = new Queue(COLA_CARRIER, { connection: conexion });
  return cola;
}

export async function encolarSyncMasterShop(datos: DatosJobSync): Promise<void> {
  if (!datos.event_id) throw new Error('carrier.sync desde el webhook requiere event_id');
  await encolarJobCarrier(obtenerCola() as unknown as ColaMinima, JOB_CARRIER_SYNC, datos, jobIdSync(datos.event_id));
}
