/**
 * Cabeceras `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset` (segundos que
 * faltan para que la ventana se reinicie). Si quedan 0 solicitudes, la siguiente espera
 * al reinicio en lugar de provocar un `429`.
 */

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** Segundos hasta el reinicio de la ventana. */
  resetSeconds: number | null;
}

function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^\s*\d+\s*$/.test(raw)) return null;
  return Number(raw);
}

export function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const info: RateLimitInfo = {
    limit: intHeader(headers, 'ratelimit-limit'),
    remaining: intHeader(headers, 'ratelimit-remaining'),
    resetSeconds: intHeader(headers, 'ratelimit-reset'),
  };
  if (info.limit === null && info.remaining === null && info.resetSeconds === null) return null;
  return info;
}

/** Espera en ms a partir de `RateLimit-Reset`; `fallbackMs` si no viene. */
export function resetDelayMs(info: RateLimitInfo | null, fallbackMs: number): number {
  return info?.resetSeconds === null || info?.resetSeconds === undefined
    ? fallbackMs
    : info.resetSeconds * 1000;
}

/** Estado de la ventana entre solicitudes de un mismo cliente. */
export class RateLimitGate {
  private blockedUntil = 0;

  /** Registra las cabeceras recibidas en el instante `now` (ms). */
  observe(info: RateLimitInfo | null, now: number): void {
    if (info === null) return;
    if (info.remaining === 0 && info.resetSeconds !== null) {
      this.blockedUntil = Math.max(this.blockedUntil, now + info.resetSeconds * 1000);
    }
  }

  /** Bloquea hasta `until` (ms), por ejemplo tras un `429`. */
  blockUntil(until: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, until);
  }

  /** Milisegundos que hay que esperar antes de la próxima solicitud. */
  waitMs(now: number): number {
    return Math.max(0, this.blockedUntil - now);
  }
}
