/**
 * Productor BullMQ de la cola `carrier` (SOLO SERVIDOR).
 * - `encolarSyncMasterShop`: `carrier.sync` con id fijo por evento (webhook); una reentrega no crea otro job.
 * - `reintentarEnvioMasterShop`: acción "Reintentar" del panel (izao-admin la conecta). Reinicia `carrier.create`
 *   con `intento: 0`; idempotente frente a doble clic y a reintentos automáticos `.r{n}` ya programados.
 */
import 'server-only';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  COLA_CARRIER,
  JOB_CARRIER_SYNC,
  encolarJobCarrier,
  jobIdSync,
  reintentarCrearEnvio,
  type ColaMinima,
  type DatosJobSync,
  type ResultadoReintentoEnvio,
} from '@izao/mastershop';

let cola: Queue | null = null;

function obtenerCola(): ColaMinima {
  if (!cola) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL no está definida');
    const conexion = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000 });
    cola = new Queue(COLA_CARRIER, { connection: conexion });
  }
  return cola as unknown as ColaMinima;
}

export async function encolarSyncMasterShop(datos: DatosJobSync): Promise<void> {
  if (!datos.event_id) throw new Error('carrier.sync desde el webhook requiere event_id');
  await encolarJobCarrier(obtenerCola(), JOB_CARRIER_SYNC, datos, jobIdSync(datos.event_id));
}

/**
 * "Reintentar" el envío a MasterShop. `estadoActual` es `orders.status` leído por quien llama (con permiso de
 * pedidos y auditoría en el panel). Devuelve `estado_invalido` fuera de `pagado`/`abono_pagado`/`error_transportadora`.
 */
export async function reintentarEnvioMasterShop(
  orderId: string,
  estadoActual: string,
  q: ColaMinima = obtenerCola(),
): Promise<ResultadoReintentoEnvio> {
  return reintentarCrearEnvio(q, orderId, estadoActual);
}
