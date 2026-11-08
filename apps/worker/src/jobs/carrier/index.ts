/**
 * Cola `carrier` del worker (dueño: izao-logistica; §14.5). El arranque (`queues.ts`/`index.ts`, de izao-infra):
 *
 *   QUEUE_NAMES.carrier = COLA_CARRIER                       // 'carrier', de @izao/mastershop
 *   const colaCarrier = createQueue(QUEUE_NAMES.carrier, connection);
 *   dependenciasPagosDesdeEnv(encolarTransportadora(colaCarrier), …)   // reemplaza el stub
 *   createWorker(QUEUE_NAMES.carrier,
 *     crearProcesadorCarrier(dependenciasCarrierDesdeEnv(programadorCarrier(colaCarrier), process.env, recalcularMetricas)),
 *     connection)
 *   // al cerrar: await colaCarrier.close()
 *
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY, MEDIA_ROOT (defecto /srv/izao/media) y
 * MASTERSHOP_MODO=simulado (opcional, nunca en producción) para usar el servidor simulado en memoria.
 */
import { currencyForCountry } from '@izao/core/money';
import type { Processor } from 'bullmq';
import {
  COLA_CARRIER,
  JOB_CARRIER_CREATE,
  JOB_CARRIER_POLL_LABEL,
  JOB_CARRIER_SYNC,
  MasterShopCarrier,
  MasterShopClient,
  encolarJobCarrier,
  esDatosJobCrear,
  esDatosJobEtiqueta,
  esDatosJobSync,
  jobIdCrear,
  jobIdEtiqueta,
  systemClock,
  type ColaMinima,
  type FetchLike,
} from '@izao/mastershop';
import { MasterShopMock, MOCK_LABEL_HOST } from '@izao/mastershop/mock';
import { conRecalculoMetricas, type RecalcularMetricasPedido } from '../metrics/tras-transicion.js';
import { crearAlmacenEtiquetas } from './almacen-etiquetas.js';
import type { DepsCarrier } from './comun.js';
import { procesarCrear } from './crear.js';
import { procesarEtiqueta } from './etiqueta.js';
import { crearFuenteCarrierPostgrest } from './fuente-postgrest.js';
import type { ProgramadorCarrier } from './fuente.js';
import { procesarSync } from './sincronizar.js';

export { COLA_CARRIER, JOB_CARRIER_CREATE, JOB_CARRIER_POLL_LABEL, JOB_CARRIER_SYNC };
export { procesarCrear } from './crear.js';
export { procesarEtiqueta } from './etiqueta.js';
export { procesarSync } from './sincronizar.js';
export type { DepsCarrier } from './comun.js';

export function crearProcesadorCarrier(deps: DepsCarrier): Processor {
  return async (job) => {
    let r: { accion: string; order_id: string | null };
    if (job.name === JOB_CARRIER_CREATE && esDatosJobCrear(job.data)) r = await procesarCrear(job.data, deps);
    else if (job.name === JOB_CARRIER_POLL_LABEL && esDatosJobEtiqueta(job.data)) r = await procesarEtiqueta(job.data, deps);
    else if (job.name === JOB_CARRIER_SYNC && esDatosJobSync(job.data)) r = await procesarSync(job.data, deps);
    else return { ok: false, motivo: 'datos_invalidos', job: job.name };
    console.log(`[worker] ${job.name} ${r.order_id ?? '-'}: ${r.accion}`);
    return r;
  };
}

/** Programador BullMQ de la cola `carrier` (ids fijos por pedido e intento). */
export function programadorCarrier(cola: ColaMinima): ProgramadorCarrier {
  return {
    async crear(orderId, intento, esperaMs) {
      await encolarJobCarrier(cola, JOB_CARRIER_CREATE, { order_id: orderId, intento }, jobIdCrear(orderId, intento), esperaMs);
    },
    async etiqueta(orderId, intento, esperaMs) {
      await encolarJobCarrier(cola, JOB_CARRIER_POLL_LABEL, { order_id: orderId, intento }, jobIdEtiqueta(orderId, intento), esperaMs);
    },
  };
}

/**
 * `encolarTransportadora(orderId)` para la cola de pagos y el botón "Reintentar": `carrier.create` con id fijo
 * `carrier.create.{orderId}`. Idempotente: si ya hay uno pendiente no hace nada; si terminó, lo vuelve a correr.
 */
export function encolarTransportadora(cola: ColaMinima): (orderId: string) => Promise<void> {
  return async (orderId) => {
    await encolarJobCarrier(cola, JOB_CARRIER_CREATE, { order_id: orderId, intento: 0 }, jobIdCrear(orderId));
  };
}

const LLAVE_SIMULADA = 'simulado-sin-red';

/**
 * `recalcularMetricas` (opcional, `recalculadorMetricasDesdeEnv(colaSistema)`): envuelve la fuente con
 * `conRecalculoMetricas` para que cada transición de `carrier.create`, `carrier.poll_label` y `carrier.sync`
 * encole `metrics.recompute_day` (§21.4), y lo usa la sincronización cuando solo cambia la tarifa.
 */
export function dependenciasCarrierDesdeEnv(
  programar: ProgramadorCarrier,
  env: NodeJS.ProcessEnv = process.env,
  recalcularMetricas?: RecalcularMetricasPedido,
): DepsCarrier {
  const supabaseUrl = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const claveCifrado = env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para la cola carrier');
  }
  const mediaRoot = env.MEDIA_ROOT ?? '/srv/izao/media';
  const fuente = conRecalculoMetricas(crearFuenteCarrierPostgrest({ supabaseUrl, secretKey, claveCifrado }), recalcularMetricas);

  if (env.MASTERSHOP_MODO === 'simulado') {
    if (env.NODE_ENV === 'production') throw new Error('MASTERSHOP_MODO=simulado no se permite en producción');
    console.warn('[worker] MasterShop en modo simulado: los pedidos no salen a la API real');
    const mock = new MasterShopMock({ apiKey: LLAVE_SIMULADA, clock: systemClock, autoLabelOnConfirm: true });
    const fetchSimulado: FetchLike = mock.fetch;
    return {
      fuente: { ...fuente, credenciales: async () => ({ apiKey: LLAVE_SIMULADA }) },
      programar,
      ...(recalcularMetricas ? { recalcularMetricas } : {}),
      etiquetas: crearAlmacenEtiquetas({ mediaRoot, fetchImpl: fetchSimulado as typeof fetch, hostsPermitidos: [MOCK_LABEL_HOST] }),
      transportadora: (_c, opciones, pais) =>
        carrierCon(new MasterShopClient({ apiKey: LLAVE_SIMULADA, fetch: fetchSimulado, currency: currencyForCountry(pais) }), opciones),
    };
  }

  return {
    fuente,
    programar,
    ...(recalcularMetricas ? { recalcularMetricas } : {}),
    etiquetas: crearAlmacenEtiquetas({ mediaRoot }),
    // La moneda del cliente es la del país de la llave (COP / USD): con ella lee los montos de las respuestas (D-052).
    transportadora: (creds, opciones, pais) =>
      carrierCon(new MasterShopClient({ apiKey: creds.apiKey, currency: currencyForCountry(pais) }), opciones),
  };
}

function carrierCon(client: MasterShopClient, opciones: Parameters<DepsCarrier['transportadora']>[1]): MasterShopCarrier {
  return new MasterShopCarrier({
    client,
    resolveOrderOptions: () => {
      if (!opciones) throw new Error('carrier: faltan las opciones para crear el pedido');
      return opciones;
    },
  });
}
