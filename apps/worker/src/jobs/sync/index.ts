/**
 * Jobs de sincronización con MasterShop (dueño: izao-logistica). Corren en la cola `sistema` por cron.
 * Cableado (izao-infra, en `cron.ts` e `index.ts`):
 *
 *   // cron.ts
 *   await colaSistema.upsertJobScheduler(JOB_POLLING_MASTERSHOP,
 *     { pattern: CRON_POLLING_MASTERSHOP, tz: 'America/Bogota' }, { name: JOB_POLLING_MASTERSHOP, data: {} });
 *   await colaSistema.upsertJobScheduler(JOB_BILLETERA_MASTERSHOP,
 *     { pattern: CRON_BILLETERA_MASTERSHOP, tz: 'America/Bogota' }, { name: JOB_BILLETERA_MASTERSHOP, data: {} });
 *   // index.ts, en crearProcesadorSistema({...})
 *   [JOB_POLLING_MASTERSHOP]: async () => pollingMasterShop(dependenciasPollingDesdeEnv(colaCarrier)),
 *   [JOB_BILLETERA_MASTERSHOP]: async () =>
 *     billeteraMasterShop(dependenciasBilleteraDesdeEnv(process.env, recalcularMetricas)),
 *
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY. Con MASTERSHOP_MODO=simulado no se llama
 * a la API (no hay pedidos simulados compartidos con la cola carrier).
 */
import { currencyForCountry, type CountryCode } from '@izao/core/money';
import { JOB_CARRIER_SYNC, MasterShopClient, encolarJobCarrier, type ColaMinima } from '@izao/mastershop';
import type { RecalcularMetricasPedido } from '../metrics/tras-transicion.js';
import type { DepsBilletera } from './billetera.js';
import { crearFuenteBilleteraPostgrest, crearFuentePollingPostgrest } from './fuente-postgrest.js';
import type { DepsPolling } from './polling.js';

export { CRON_POLLING_MASTERSHOP, JOB_POLLING_MASTERSHOP, pollingMasterShop } from './polling.js';
export type { DepsPolling, ResultadoPolling } from './polling.js';
export { CRON_BILLETERA_MASTERSHOP, JOB_BILLETERA_MASTERSHOP, billeteraMasterShop } from './billetera.js';
export type { DepsBilletera, ResultadoBilletera } from './billetera.js';

/** Países con MasterShop: cada uno con su propia llave (D-052). Sin llave activa, el país se salta. */
export const PAISES_MASTERSHOP: readonly CountryCode[] = ['CO', 'EC'];

function opcionesDesdeEnv(env: NodeJS.ProcessEnv) {
  const supabaseUrl = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const claveCifrado = env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para la sincronización de MasterShop');
  }
  return { supabaseUrl, secretKey, claveCifrado };
}

export function dependenciasPollingDesdeEnv(colaCarrier: ColaMinima, env: NodeJS.ProcessEnv = process.env): DepsPolling {
  const fuente = crearFuentePollingPostgrest(opcionesDesdeEnv(env));
  const simulado = env.MASTERSHOP_MODO === 'simulado';
  return {
    fuente: simulado ? { ...fuente, credenciales: async () => null } : fuente,
    paises: PAISES_MASTERSHOP,
    listar: (creds, desde, pais) =>
      new MasterShopClient({ apiKey: creds.apiKey, currency: currencyForCountry(pais) }).listAllOrders({ startDate: desde }),
    encolarSync: (datos, jobId) => encolarJobCarrier(colaCarrier, JOB_CARRIER_SYNC, datos, jobId),
  };
}

/** `recalcularMetricas` (`recalculadorMetricasDesdeEnv(colaSistema)`): recálculo de los días de cada pedido con costos nuevos. */
export function dependenciasBilleteraDesdeEnv(
  env: NodeJS.ProcessEnv = process.env,
  recalcularMetricas?: RecalcularMetricasPedido,
): DepsBilletera {
  const fuente = crearFuenteBilleteraPostgrest(opcionesDesdeEnv(env));
  const simulado = env.MASTERSHOP_MODO === 'simulado';
  return {
    fuente: simulado ? { ...fuente, credenciales: async () => null } : fuente,
    ...(recalcularMetricas ? { recalcularMetricas } : {}),
    paises: PAISES_MASTERSHOP,
    listar: (creds, desde, pais) =>
      new MasterShopClient({ apiKey: creds.apiKey, currency: currencyForCountry(pais) }).listAllWalletMovements({ startDate: desde }),
    // PENDIENTE: canal de alertas al admin (WhatsApp/correo, §15.5). Hoy queda la bandera en country_settings.
    async avisarSaldoBajo(saldo, umbral, pais) {
      const moneda = currencyForCountry(pais);
      console.warn(`[worker] billetera MasterShop ${pais} con saldo bajo: ${saldo.toString()} < ${umbral.toString()} (${moneda}, unidad menor)`);
    },
  };
}
