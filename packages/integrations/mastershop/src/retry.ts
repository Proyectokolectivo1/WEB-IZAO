/**
 * Política de reintentos de los jobs de transportadora (§14.5): 30 s, 2 min, 10 min,
 * 30 min y 2 h. Pura: recibe el instante y devuelve cuándo reintentar o si rendirse.
 * Los valores son los del *seed*; el worker puede pasar otros desde la configuración.
 */
import { isMasterShopError } from './errors';

export const DEFAULT_CARRIER_RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
]);

/**
 * Espera antes del reintento número `retryNumber` (1 = primer reintento, tras el primer
 * fallo). `null` cuando ya no quedan reintentos.
 */
export function carrierRetryDelay(
  retryNumber: number,
  delays: readonly number[] = DEFAULT_CARRIER_RETRY_DELAYS_MS,
): number | null {
  if (!Number.isInteger(retryNumber) || retryNumber < 1) {
    throw new RangeError('retryNumber debe ser un entero ≥ 1.');
  }
  return delays[retryNumber - 1] ?? null;
}

export type RetryDecision =
  | { action: 'retry'; delayMs: number; at: Date; retryNumber: number }
  | { action: 'give_up'; reason: 'no_reintentable' | 'reintentos_agotados' };

/**
 * Decide qué hacer tras un fallo.
 * - Errores no reintentables (validación, autenticación, 404, estado no editable,
 *   rechazo, 502 sin confirmar) → rendirse ya: el pedido pasa a `error_transportadora`.
 * - `429` → esperar lo mayor entre la política y `RateLimit-Reset`.
 * - Errores desconocidos (no de MasterShop) se tratan como reintentables.
 */
export function planCarrierRetry(input: {
  /** Fallos ocurridos hasta ahora, incluido este (BullMQ `attemptsMade`). */
  failures: number;
  error: unknown;
  now: Date;
  delays?: readonly number[];
}): RetryDecision {
  const { failures, error, now } = input;
  if (isMasterShopError(error) && !error.retryable) {
    return { action: 'give_up', reason: 'no_reintentable' };
  }
  const base = carrierRetryDelay(failures, input.delays);
  if (base === null) return { action: 'give_up', reason: 'reintentos_agotados' };
  const hint = isMasterShopError(error) ? (error.retryAfterMs ?? 0) : 0;
  const delayMs = Math.max(base, hint);
  return { action: 'retry', delayMs, at: new Date(now.getTime() + delayMs), retryNumber: failures };
}
