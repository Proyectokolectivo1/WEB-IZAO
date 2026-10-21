/**
 * Notificaciones de MasterShop (§14.5 paso 4; colección de Postman, carpeta "Webhooks", observado el
 * 2026-10-02). El sobre es `{ eventName, body }` con el pedido completo en `body`. No hay firma, HMAC
 * ni secreto compartido: la única protección es el segmento secreto de la URL. Tampoco se garantiza
 * orden ni entrega única, y el esquema puede cambiar: aquí solo se extrae la referencia del pedido y
 * datos para deduplicar; el job reconsulta `GET /api/orders` antes de cambiar nada.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Mínimo de caracteres de `MASTERSHOP_WEBHOOK_PATH_SECRET` (≥ 128 bits en base64url/hex). */
export const WEBHOOK_SECRET_MIN_LENGTH = 32;

/** Compara el segmento de la URL con el secreto en tiempo constante. Un secreto corto nunca valida. */
export function verificarSecretoRuta(recibido: string, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < WEBHOOK_SECRET_MIN_LENGTH) return false;
  const a = createHash('sha256').update(recibido, 'utf8').digest();
  const b = createHash('sha256').update(esperado, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export interface NotificacionMasterShop {
  eventName: string | null;
  providerOrderId: number | null;
  externalOrderId: string | null;
  idStatus: number | null;
  /** `carrier_status_info.carrier_status`: distingue En Reparto, En Oficina y Con Novedad (todos con 6). */
  carrierStatus: string | null;
  carrierStatusCode: string | null;
  dateUpdate: string | null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown, max = 120): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

function idPositivo(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

const NUMERO_PEDIDO = /^[A-Za-z0-9-]{1,40}$/;

/**
 * Lee el sobre tolerando variantes de escritura (`id_order`/`idOrder`, `external_order_id`/
 * `externalOrderId`, `id_status`/`idStatus`). `null` si no trae ninguna referencia del pedido.
 */
export function parsearNotificacion(json: unknown): NotificacionMasterShop | null {
  const sobre = obj(json);
  if (!sobre) return null;
  const body = obj(sobre.body) ?? sobre;
  const externo = texto(body.external_order_id ?? body.externalOrderId, 40);
  const n: NotificacionMasterShop = {
    eventName: texto(sobre.eventName),
    providerOrderId: idPositivo(body.id_order ?? body.idOrder),
    externalOrderId: externo !== null && NUMERO_PEDIDO.test(externo) ? externo : null,
    idStatus: idPositivo(body.id_status ?? body.idStatus),
    carrierStatus: texto(obj(body.carrier_status_info)?.carrier_status),
    carrierStatusCode: texto(obj(body.carrier_status_info)?.carrier_status_code, 40),
    dateUpdate: texto(body.date_update_order ?? body.dateUpdateOrder, 40),
  };
  if (n.providerOrderId === null && n.externalOrderId === null) return null;
  return n;
}

/**
 * `webhook_events.event_id` determinista: pedido + estado + hash corto de lo que distingue la
 * notificación (evento, estado de la transportadora, fecha de actualización). Una reentrega idéntica
 * da el mismo id; un cambio real (otra fecha o subestado) da otro. Solo `[A-Za-z0-9.-]`.
 */
export function idEventoNotificacion(n: NotificacionMasterShop): string {
  const ref = n.providerOrderId !== null ? String(n.providerOrderId) : `x${n.externalOrderId}`;
  const huella = createHash('sha256')
    .update(
      JSON.stringify([n.eventName, n.idStatus, n.carrierStatus, n.carrierStatusCode, n.dateUpdate, n.externalOrderId]),
    )
    .digest('hex')
    .slice(0, 16);
  return `${ref}.${n.idStatus ?? 0}.${huella}`;
}

/** Carga mínima para `webhook_events.payload`: sin datos del cliente (el cuerpo trae el pedido completo). */
export function payloadRegistrable(n: NotificacionMasterShop): Record<string, string | number | null> {
  return {
    eventName: n.eventName,
    id_order: n.providerOrderId,
    external_order_id: n.externalOrderId,
    id_status: n.idStatus,
    carrier_status: n.carrierStatus,
    carrier_status_code: n.carrierStatusCode,
    date_update_order: n.dateUpdate,
  };
}
