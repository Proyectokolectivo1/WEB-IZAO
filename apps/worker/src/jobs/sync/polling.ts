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

export interface FuentePolling {
  credenciales(): Promise<MasterShopCredentials | null>;
  enviosAbiertos(): Promise<EnvioAbierto[]>;
}

export interface DepsPolling {
  fuente: FuentePolling;
  /** Todas las páginas desde `desde` (`MasterShopClient.listAllOrders`). */
  listar(creds: MasterShopCredentials, desde: Date): Promise<MasterShopListItem[]>;
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
}

export function jobIdPolling(providerOrderId: number): string {
  return jobIdSync(`polling.${providerOrderId}`);
}

function difiere(local: EnvioAbierto, remoto: MasterShopListItem): boolean {
  if (remoto.statusId !== local.provider_status_id) return true;
  if (remoto.hasNovelty !== local.has_novelty) return true;
  return remoto.trackingCode !== null && remoto.trackingCode !== local.tracking_code;
}

export async function pollingMasterShop(deps: DepsPolling): Promise<ResultadoPolling> {
  const r: ResultadoPolling = {
    accion: 'revisado',
    listados: 0,
    abiertos: 0,
    encolados: 0,
    ya_pendientes: 0,
    estado_desconocido: 0,
    ausentes: 0,
  };
  const creds = await deps.fuente.credenciales();
  if (!creds) return { ...r, accion: 'sin_credenciales' };
  const abiertos = await deps.fuente.enviosAbiertos();
  r.abiertos = abiertos.length;
  if (abiertos.length === 0) return { ...r, accion: 'sin_envios_abiertos' };

  const ahora = (deps.ahora ?? (() => new Date()))();
  const desde = new Date(ahora.getTime() - VENTANA_POLLING_DIAS * 86_400_000);
  const remotos = await deps.listar(creds, desde);
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
