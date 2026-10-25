/**
 * Recálculo de métricas tras cada transición del pedido (§21.4, D-033). Los jobs de pagos, financiación y contra
 * entrega cambian el pedido solo con `aplicarTransicion` de su fuente; `conRecalculoMetricas` envuelve ese método
 * para que, cuando la transición queda aplicada, se encole `metrics.recompute_day` de los días que el pedido puede
 * mover (creación y pago, en Bogotá) con `encolarRecalculoPedido` (debounce de 1 min por fecha y país).
 *
 * - Se lee el pedido **después** de la transición: `paid_at` ya es el que fijó la base.
 * - Si el encolado falla (Redis o la base caídos) la transición no se deshace ni se reintenta el job: se registra
 *   y el nocturno `metrics.recompute_recent` (60 días) corrige el agregado.
 */
import type { Queue } from 'bullmq';
import type { CountryCode } from '@izao/core/money';
import { crearClientePostgrest, eq, type OpcionesPostgrest } from '../postgrest.js';
import { PAISES_METRICAS, encolarRecalculoPedido } from './recalcular-dia.js';

export type RecalcularMetricasPedido = (orderId: string) => Promise<void>;

export interface FechasPedido {
  country_code: CountryCode;
  created_at: Date;
  paid_at: Date | null;
}

type ConTransicion = { aplicarTransicion(orderId: string, ...resto: never[]): Promise<boolean> };

export function conRecalculoMetricas<F extends ConTransicion>(fuente: F, recalcular: RecalcularMetricasPedido | undefined): F {
  if (!recalcular) return fuente;
  const original = fuente.aplicarTransicion.bind(fuente) as (...a: unknown[]) => Promise<boolean>;
  const aplicarTransicion = async (orderId: string, ...resto: unknown[]): Promise<boolean> => {
    const aplicada = await original(orderId, ...resto);
    if (aplicada) {
      try {
        await recalcular(orderId);
      } catch (e) {
        console.error(`[metricas] metrics.recompute_day no encolado: ${e instanceof Error ? e.name : 'error'}`);
      }
    }
    return aplicada;
  };
  return { ...fuente, aplicarTransicion } as F;
}

export function recalculadorMetricas(
  cola: Queue,
  leer: (orderId: string) => Promise<FechasPedido | null>,
): RecalcularMetricasPedido {
  return async (orderId) => {
    const p = await leer(orderId);
    if (p) await encolarRecalculoPedido(cola, p);
  };
}

function fecha(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function leerFechasPedidoPostgrest(o: OpcionesPostgrest): (orderId: string) => Promise<FechasPedido | null> {
  const c = crearClientePostgrest(o);
  return async (orderId) => {
    const [f] = await c.filas('orders', `orders?id=${eq(orderId)}&select=country_code,created_at,paid_at`);
    if (!f) return null;
    const pais = f.country_code as CountryCode;
    const creado = fecha(f.created_at);
    const pagado = f.paid_at === null ? null : fecha(f.paid_at);
    if (!PAISES_METRICAS.includes(pais) || !creado || (f.paid_at !== null && !pagado)) return null;
    return { country_code: pais, created_at: creado, paid_at: pagado };
  };
}

/** Para el arranque: `recalculadorMetricasDesdeEnv(colaSistema)` y pasarlo a las dependencias de cada cola. */
export function recalculadorMetricasDesdeEnv(colaMetricas: Queue): RecalcularMetricasPedido {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para recalcular métricas');
  }
  return recalculadorMetricas(colaMetricas, leerFechasPedidoPostgrest({ supabaseUrl, secretKey, claveCifrado }));
}
