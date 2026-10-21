/**
 * Contrato de la cola `carrier` (§14.5) compartido por el worker (consumidor) y la web (webhook,
 * botón "Reintentar"). BullMQ no admite `:` en ids personalizados: se usan puntos.
 */

export const COLA_CARRIER = 'carrier';

export const JOB_CARRIER_CREATE = 'carrier.create';
export const JOB_CARRIER_POLL_LABEL = 'carrier.poll_label';
export const JOB_CARRIER_SYNC = 'carrier.sync';

/** Esperas entre intentos de `carrier.create` (§14.5): 30 s, 2 min, 10 min, 30 min, 2 h. */
export const CARRIER_CREATE_RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  30_000, 120_000, 600_000, 1_800_000, 7_200_000,
]);

/** `carrier.poll_label` cada 2 min; tope de 12 h antes de alertar al admin. */
export const LABEL_POLL_INTERVAL_MS = 120_000;
export const LABEL_POLL_MAX_ATTEMPTS = 360;

export interface DatosJobCrear {
  order_id: string;
  /** 0 = primer intento; n = n-ésimo reintento programado. */
  intento: number;
}

export interface DatosJobEtiqueta {
  order_id: string;
  intento: number;
}

export interface DatosJobSync {
  /** `webhook_events.event_id` si viene del webhook; `null` desde el polling. */
  event_id: string | null;
  provider_order_id: number | null;
  external_order_id: string | null;
  origen: 'webhook' | 'polling';
}

const SEGURO = /^[A-Za-z0-9._-]+$/;

function seguro(parte: string, nombre: string): string {
  if (!SEGURO.test(parte)) throw new Error(`${nombre} no es válido para un id de job`);
  return parte;
}

export function jobIdCrear(orderId: string, intento = 0): string {
  const base = `carrier.create.${seguro(orderId, 'orderId')}`;
  return intento === 0 ? base : `${base}.r${intento}`;
}

export function jobIdEtiqueta(orderId: string, intento: number): string {
  return `carrier.poll_label.${seguro(orderId, 'orderId')}.${intento}`;
}

export function jobIdSync(eventId: string): string {
  return `carrier.sync.${seguro(eventId, 'eventId')}`;
}

/** Lo mínimo de `bullmq.Queue` que usa el productor (para no depender de BullMQ en este paquete). */
export interface ColaMinima {
  getJob(id: string): Promise<{ getState(): Promise<string>; remove(): Promise<void> } | undefined | null>;
  add(name: string, data: unknown, opts: Record<string, unknown>): Promise<unknown>;
}

/** Opciones BullMQ: los reintentos de negocio son propios; estos cubren fallos de infraestructura. */
export const OPCIONES_JOB_CARRIER = Object.freeze({
  attempts: 4,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 30 * 24 * 3600 },
});

/**
 * Agrega un job con id fijo. Si ya hay uno pendiente o activo no hace nada; si el anterior terminó
 * (completado o fallido) lo reemplaza, para que "Reintentar" del panel vuelva a ejecutar `carrier.create`.
 */
export async function encolarJobCarrier(
  cola: ColaMinima,
  nombre: string,
  datos: DatosJobCrear | DatosJobEtiqueta | DatosJobSync,
  jobId: string,
  esperaMs = 0,
): Promise<'encolado' | 'ya_pendiente'> {
  const previo = await cola.getJob(jobId);
  if (previo) {
    const estado = await previo.getState();
    if (estado !== 'completed' && estado !== 'failed') return 'ya_pendiente';
    await previo.remove();
  }
  await cola.add(nombre, datos, { ...OPCIONES_JOB_CARRIER, jobId, ...(esperaMs > 0 ? { delay: esperaMs } : {}) });
  return 'encolado';
}

function entero(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
}

export function esDatosJobCrear(d: unknown): d is DatosJobCrear {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  return typeof r.order_id === 'string' && SEGURO.test(r.order_id) && entero(r.intento, 0);
}

export const esDatosJobEtiqueta = esDatosJobCrear as (d: unknown) => d is DatosJobEtiqueta;

export function esDatosJobSync(d: unknown): d is DatosJobSync {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  const ref =
    (entero(r.provider_order_id, 1) || r.provider_order_id === null) &&
    (typeof r.external_order_id === 'string' || r.external_order_id === null) &&
    (r.provider_order_id !== null || r.external_order_id !== null);
  return (
    ref &&
    (typeof r.event_id === 'string' || r.event_id === null) &&
    (r.origen === 'webhook' || r.origen === 'polling')
  );
}
