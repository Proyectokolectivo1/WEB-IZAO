/**
 * Job `metrics.recompute_day` (§21.4, skill izao-metricas): recalcula desde cero las 5 filas de
 * `daily_sales_stats` (una por método) de un día de Bogotá y un país con `filasVentasDiarias` de
 * `@izao/core/metrics`, y las escribe con upsert por la llave primaria (date, country_code, payment_method).
 *
 * - Idempotente: siempre lee el estado actual de los pedidos y pisa las filas; repetirlo no acumula.
 * - Debounce de 1 min por fecha+país: deduplicación de BullMQ con id `metrics.recompute_day.{fecha}.{país}`,
 *   espera de 60 s y `keepLastIfActive` (nunca dos cálculos del mismo día a la vez; un cambio que llega mientras
 *   se calcula deja un único job más). No se usa `jobId` fijo: un job terminado con ese id bloquearía los
 *   siguientes (D-033).
 * - Reintentos: 5 con espera exponencial (10 s). Datos inválidos (payload, pedido mal atribuido) →
 *   `UnrecoverableError`, sin reintentos ni escritura.
 * - Nocturno `metrics.recompute_recent`: encola los últimos 60 días por país sin espera.
 */
import { UnrecoverableError, type Job, type JobsOptions, type Processor, type Queue } from 'bullmq';
import {
  esFechaIso,
  fechaBogota,
  filasVentasDiarias,
  sumarDias,
  type FechaIso,
  type FilaVentasDiarias,
  type PedidoMetrica,
} from '@izao/core/metrics';
import type { CountryCode } from '@izao/core/money';
import { crearFuenteMetricasPostgrest } from './fuente-postgrest.js';

export const JOB_METRICS_RECOMPUTE_DAY = 'metrics.recompute_day';
export const JOB_METRICS_RECOMPUTE_RECENT = 'metrics.recompute_recent';
export const DEBOUNCE_RECALCULO_MS = 60_000;
export const DIAS_RECALCULO_NOCTURNO = 60;
export const PAISES_METRICAS: readonly CountryCode[] = Object.freeze(['CO', 'EC'] as const);

export interface DatosJobRecalculoDia {
  /** Día en Bogotá, `YYYY-MM-DD`. */
  date: FechaIso;
  country_code: CountryCode;
}

export interface FuenteMetricas {
  /** Exactamente los pedidos atribuidos a `fecha` (Bogotá) y `pais`: `paid_at`, o `created_at` sin pago. */
  pedidosDelDia(fecha: FechaIso, pais: CountryCode): Promise<PedidoMetrica[]>;
  /** Upsert de las filas por (date, country_code, payment_method). */
  guardarFilas(filas: FilaVentasDiarias[], ahora: Date): Promise<void>;
}

export interface DepsMetricas {
  fuente: FuenteMetricas;
  ahora?: () => Date;
}

const esPais = (v: unknown): v is CountryCode => typeof v === 'string' && (PAISES_METRICAS as readonly string[]).includes(v);

export function parseDatosRecalculoDia(d: unknown): DatosJobRecalculoDia | null {
  if (typeof d !== 'object' || d === null) return null;
  const { date, country_code } = d as Record<string, unknown>;
  if (!esFechaIso(date) || !esPais(country_code)) return null;
  return { date, country_code };
}

export function idDeduplicacionRecalculo(fecha: FechaIso, pais: CountryCode): string {
  return `${JOB_METRICS_RECOMPUTE_DAY}.${fecha}.${pais}`;
}

export async function recalcularDia(
  deps: DepsMetricas,
  datos: DatosJobRecalculoDia,
): Promise<{ ok: true; date: FechaIso; country_code: CountryCode; filas: number; pedidos: number }> {
  const pedidos = await deps.fuente.pedidosDelDia(datos.date, datos.country_code);
  let filas: FilaVentasDiarias[];
  try {
    filas = filasVentasDiarias(pedidos, datos.date, datos.country_code);
  } catch (e) {
    // Datos que no cuadran (país, moneda, atribución, montos): reintentar no lo arregla.
    throw new UnrecoverableError(e instanceof Error ? e.message : 'datos inválidos');
  }
  await deps.fuente.guardarFilas(filas, (deps.ahora ?? (() => new Date()))());
  return { ok: true, date: datos.date, country_code: datos.country_code, filas: filas.length, pedidos: pedidos.length };
}

/** Manejador para la cola `sistema` (`crearProcesadorSistema({ [JOB_METRICS_RECOMPUTE_DAY]: … })`). */
export function crearManejadorRecalculoDia(deps: DepsMetricas): Processor {
  return async (job: Job) => {
    const datos = parseDatosRecalculoDia(job.data);
    if (!datos) throw new UnrecoverableError(`${JOB_METRICS_RECOMPUTE_DAY}: datos inválidos`);
    const r = await recalcularDia(deps, datos);
    console.log(`[metrics] ${r.date} ${r.country_code}: ${r.pedidos} pedidos, ${r.filas} filas`);
    return r;
  };
}

function opcionesRecalculo(fecha: FechaIso, pais: CountryCode, delay: number): JobsOptions {
  return {
    delay,
    deduplication: { id: idDeduplicacionRecalculo(fecha, pais), keepLastIfActive: true },
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

/** Encola el recálculo de un día con debounce (por defecto 1 min). Para quien cambie un pedido. */
export async function encolarRecalculoDia(cola: Queue, fecha: FechaIso, pais: CountryCode, delay = DEBOUNCE_RECALCULO_MS): Promise<void> {
  if (!esFechaIso(fecha)) throw new RangeError('Fecha inválida.');
  if (!esPais(pais)) throw new RangeError('País inválido.');
  const datos: DatosJobRecalculoDia = { date: fecha, country_code: pais };
  await cola.add(JOB_METRICS_RECOMPUTE_DAY, datos, opcionesRecalculo(fecha, pais, delay));
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

export async function encolarRecalculoPedido(
  cola: Queue,
  p: { country_code: CountryCode; created_at: Date; paid_at: Date | null },
): Promise<void> {
  for (const f of fechasAfectadas(p)) await encolarRecalculoDia(cola, f, p.country_code);
}

/** Manejador del nocturno: últimos 60 días (hoy en Bogotá incluido) por país, sin espera. */
export function crearManejadorRecalculoReciente(cola: Queue, ahora: () => Date = () => new Date()): Processor {
  return async () => {
    const hoy = fechaBogota(ahora());
    let encolados = 0;
    for (const pais of PAISES_METRICAS) {
      for (let i = 0; i < DIAS_RECALCULO_NOCTURNO; i++) {
        await encolarRecalculoDia(cola, sumarDias(hoy, -i), pais, 0);
        encolados += 1;
      }
    }
    return { ok: true, encolados };
  };
}

export function dependenciasMetricasDesdeEnv(): DepsMetricas {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para las métricas');
  }
  return { fuente: crearFuenteMetricasPostgrest({ supabaseUrl, secretKey, claveCifrado }) };
}
