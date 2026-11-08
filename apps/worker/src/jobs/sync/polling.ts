/**
 * Polling de respaldo de MasterShop (§14.5 paso 4): cada 10 min lista `POST /api/orders/list` con
 * `startDate` = hace 45 días (sin él MasterShop devuelve solo 7 días) paginando hasta una página vacía
 * (MasterShop recorta `limit` a 50 en silencio), y encola `carrier.sync` (`origen: 'polling'`) solo para los
 * envíos abiertos cuyo estado, novedad o guía difieren de lo guardado. La verdad la pone `carrier.sync`,
 * que reconsulta el pedido; este job no escribe en la base.
 *
 * Idempotente: id de job fijo por pedido (`carrier.sync.polling.{idOrder}`), así una corrida repetida no
 * duplica trabajo pendiente; si nada cambió no encola nada.
 */
import type { CountryCode } from '@izao/core/money';
import { jobIdSync, type DatosJobSync, type MasterShopCredentials, type MasterShopListItem } from '@izao/mastershop';

export const JOB_POLLING_MASTERSHOP = 'mastershop.polling';
export const CRON_POLLING_MASTERSHOP = '*/10 * * * *';
/** Ventana del listado (§14.5): pedidos de los últimos 45 días. */
export const VENTANA_POLLING_DIAS = 45;
/** Un envío abierto que no aparece en el listado se reconsulta como mucho cada hora. */
export const RECONSULTA_AUSENTE_MS = 3_600_000;

/** `shipments` con `provider_order_id` cuyo pedido no está en un estado terminal. */
export interface EnvioAbierto {
  order_id: string;
  external_order_id: string;
  provider_order_id: number;
  provider_status_id: number | null;
  has_novelty: boolean;
  tracking_code: string | null;
  last_synced_at: Date | null;
  /** Hay `label_url` pero no copia local (p. ej. el CDN bloquea al VPS, D-051): se sincroniza aunque nada cambie. */
  etiqueta_pendiente?: boolean;
}

/** Cada país tiene su propia llave y su propio negocio en MasterShop (D-052): se recorre país por país. */
export interface FuentePolling {
  credenciales(pais: CountryCode): Promise<MasterShopCredentials | null>;
  /** Envíos abiertos de pedidos de ese país. */
  enviosAbiertos(pais: CountryCode): Promise<EnvioAbierto[]>;
}

export interface DepsPolling {
  fuente: FuentePolling;
  /** Países a revisar (defecto `['CO']`). Un país sin llave activa queda en `sin_credenciales` sin tocar a los demás. */
  paises?: readonly CountryCode[];
  /** Todas las páginas desde `desde` (`MasterShopClient.listAllOrders`) con la llave del país. */
  listar(creds: MasterShopCredentials, desde: Date, pais: CountryCode): Promise<MasterShopListItem[]>;
  encolarSync(datos: DatosJobSync, jobId: string): Promise<'encolado' | 'ya_pendiente'>;
  ahora?: () => Date;
}

export interface ResultadoPolling {
  accion: 'sin_credenciales' | 'sin_envios_abiertos' | 'revisado';
  listados: number;
  abiertos: number;
  encolados: number;
  ya_pendientes: number;
  /** Fila del listado con un nombre de estado fuera de la tabla de §14.6 (no se encola: `sync` alertaría cada 10 min). */
  estado_desconocido: number;
  /** Envíos abiertos que no salieron en el listado y se reconsultan por id. */
  ausentes: number;
  /** Con más de un país: resultado de cada uno (los contadores de arriba son la suma). */
  por_pais?: Partial<Record<CountryCode, ResultadoPolling['accion']>>;
}

export function jobIdPolling(providerOrderId: number): string {
  return jobIdSync(`polling.${providerOrderId}`);
}

function difiere(local: EnvioAbierto, remoto: MasterShopListItem): boolean {
  if (remoto.statusId !== local.provider_status_id) return true;
  if (remoto.hasNovelty !== local.has_novelty) return true;
  return remoto.trackingCode !== null && remoto.trackingCode !== local.tracking_code;
}

/** Revisa cada país con su llave; un error en un país no impide revisar los demás (se relanza al final). */
export async function pollingMasterShop(deps: DepsPolling): Promise<ResultadoPolling> {
  const paises = deps.paises ?? ['CO'];
  if (paises.length === 1) return pollingPais(deps, paises[0]!);
  const total: ResultadoPolling = {
    accion: 'sin_credenciales',
    listados: 0,
    abiertos: 0,
    encolados: 0,
    ya_pendientes: 0,
    estado_desconocido: 0,
    ausentes: 0,
    por_pais: {},
  };
  let fallo: unknown = null;
  for (const pais of paises) {
    let r: ResultadoPolling;
    try {
      r = await pollingPais(deps, pais);
    } catch (e) {
      fallo ??= e;
      continue;
    }
    total.por_pais![pais] = r.accion;
    for (const k of ['listados', 'abiertos', 'encolados', 'ya_pendientes', 'estado_desconocido', 'ausentes'] as const) total[k] += r[k];
    if (r.accion === 'revisado' || (r.accion === 'sin_envios_abiertos' && total.accion === 'sin_credenciales')) total.accion = r.accion;
  }
  if (fallo !== null) throw fallo;
  return total;
}

async function pollingPais(deps: DepsPolling, pais: CountryCode): Promise<ResultadoPolling> {
  const r: ResultadoPolling = {
    accion: 'revisado',
    listados: 0,
    abiertos: 0,
    encolados: 0,
    ya_pendientes: 0,
    estado_desconocido: 0,
    ausentes: 0,
  };
  const creds = await deps.fuente.credenciales(pais);
  if (!creds) return { ...r, accion: 'sin_credenciales' };
  const abiertos = await deps.fuente.enviosAbiertos(pais);
  r.abiertos = abiertos.length;
  if (abiertos.length === 0) return { ...r, accion: 'sin_envios_abiertos' };

  const ahora = (deps.ahora ?? (() => new Date()))();
  const desde = new Date(ahora.getTime() - VENTANA_POLLING_DIAS * 86_400_000);
  const remotos = await deps.listar(creds, desde, pais);
  r.listados = remotos.length;
  const porId = new Map(remotos.map((x) => [x.idOrder, x]));

  const encolar = async (e: EnvioAbierto): Promise<void> => {
    const datos: DatosJobSync = {
      event_id: null,
      provider_order_id: e.provider_order_id,
      external_order_id: e.external_order_id,
      origen: 'polling',
    };
    const res = await deps.encolarSync(datos, jobIdPolling(e.provider_order_id));
    if (res === 'encolado') r.encolados++;
    else r.ya_pendientes++;
  };

  for (const e of abiertos) {
    const remoto = porId.get(e.provider_order_id);
    if (!remoto) {
      // Más viejo que la ventana o el listado no lo trajo: `sync` lo reconsulta por id (sin ventana).
      const reciente = e.last_synced_at !== null && ahora.getTime() - e.last_synced_at.getTime() < RECONSULTA_AUSENTE_MS;
      if (!reciente) {
        r.ausentes++;
        await encolar(e);
      }
      continue;
    }
    if (remoto.externalOrderId !== null && remoto.externalOrderId !== e.external_order_id) continue;
    if (remoto.statusId === null) {
      r.estado_desconocido++;
      continue;
    }
    // D-051: la etiqueta pendiente se reintenta en cada vuelta (crea el `print_job` para el agente y, cuando el CDN
    // libere la IP, guarda la copia local). `jobIdPolling` evita duplicados.
    if (difiere(e, remoto) || e.etiqueta_pendiente === true) await encolar(e);
  }
  return r;
}
