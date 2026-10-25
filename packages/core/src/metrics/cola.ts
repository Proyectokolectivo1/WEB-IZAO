/**
 * Contrato del productor de `metrics.recompute_day` (§21.4, D-033), compartido por el worker y la web: nombre,
 * deduplicación por fecha y país, opciones y días afectados por un cambio del pedido. Sin dependencia de BullMQ:
 * `ColaRecalculo` es la forma mínima de `Queue.add`, así que una `Queue` de la cola `sistema` encaja tal cual.
 *
 * - Debounce de 1 min con deduplicación `metrics.recompute_day.{fecha}.{país}` y `keepLastIfActive`; nunca un
 *   `jobId` fijo (un job terminado con ese id bloquearía los siguientes).
 * - Reintentos: 5 con espera exponencial de 10 s.
 */
import type { CountryCode } from '../money';
import { esFechaIso, fechaBogota, type FechaIso } from './fechas';

export const COLA_METRICAS = 'sistema';
export const JOB_METRICS_RECOMPUTE_DAY = 'metrics.recompute_day';
export const DEBOUNCE_RECALCULO_MS = 60_000;
export const PAISES_METRICAS: readonly CountryCode[] = Object.freeze(['CO', 'EC'] as const);

export interface DatosJobRecalculoDia {
  /** Día en Bogotá, `YYYY-MM-DD`. */
  date: FechaIso;
  country_code: CountryCode;
}

export interface OpcionesJobRecalculo {
  delay: number;
  deduplication: { id: string; keepLastIfActive: true };
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number };
}

/** Forma mínima de `Queue.add` de BullMQ. */
export interface ColaRecalculo {
  add(nombre: string, datos: DatosJobRecalculoDia, opciones: OpcionesJobRecalculo): Promise<unknown>;
}

/** Fechas y país de un pedido, leídos **después** del cambio. */
export interface FechasPedido {
  country_code: CountryCode;
  created_at: Date;
  paid_at: Date | null;
}

export const esPaisMetricas = (v: unknown): v is CountryCode =>
  typeof v === 'string' && (PAISES_METRICAS as readonly string[]).includes(v);

export function idDeduplicacionRecalculo(fecha: FechaIso, pais: CountryCode): string {
  return `${JOB_METRICS_RECOMPUTE_DAY}.${fecha}.${pais}`;
}

export function opcionesRecalculo(fecha: FechaIso, pais: CountryCode, delay: number): OpcionesJobRecalculo {
  return {
    delay,
    deduplication: { id: idDeduplicacionRecalculo(fecha, pais), keepLastIfActive: true },
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

/** Encola el recálculo de un día con debounce (por defecto 1 min). */
export async function encolarRecalculoDia(
  cola: ColaRecalculo,
  fecha: FechaIso,
  pais: CountryCode,
  delay = DEBOUNCE_RECALCULO_MS,
): Promise<void> {
  if (!esFechaIso(fecha)) throw new RangeError('Fecha inválida.');
  if (!esPaisMetricas(pais)) throw new RangeError('País inválido.');
  await cola.add(JOB_METRICS_RECOMPUTE_DAY, { date: fecha, country_code: pais }, opcionesRecalculo(fecha, pais, delay));
}

/** Días que un cambio del pedido puede mover: el de creación y el de pago (la atribución pasa del uno al otro). */
export function fechasAfectadas(p: { created_at: Date; paid_at: Date | null }): FechaIso[] {
  const fechas = [fechaBogota(p.created_at)];
  if (p.paid_at) {
    const pago = fechaBogota(p.paid_at);
    if (pago !== fechas[0]) fechas.push(pago);
  }
  return fechas;
}

export async function encolarRecalculoPedido(cola: ColaRecalculo, p: FechasPedido): Promise<void> {
  for (const f of fechasAfectadas(p)) await encolarRecalculoDia(cola, f, p.country_code);
}

function instante(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fila `orders(country_code, created_at, paid_at)` → `FechasPedido`; `null` si algo no cuadra. */
export function fechasPedidoDeFila(f: unknown): FechasPedido | null {
  if (typeof f !== 'object' || f === null) return null;
  const { country_code, created_at, paid_at } = f as Record<string, unknown>;
  const creado = instante(created_at);
  const pagado = paid_at === null || paid_at === undefined ? null : instante(paid_at);
  if (!esPaisMetricas(country_code) || !creado || (paid_at != null && !pagado)) return null;
  return { country_code, created_at: creado, paid_at: pagado };
}
