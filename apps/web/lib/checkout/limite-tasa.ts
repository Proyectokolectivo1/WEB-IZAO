/**
 * Límite de peticiones por cliente (§26.1). Ventana fija por clave.
 *
 * PROVISIONAL: vive en la memoria del proceso de `apps/web` (un solo contenedor en el VPS). Cuando exista
 * el cliente Redis compartido (pendiente técnico de izao-infra), se implementa `LimitadorTasa` sobre Redis
 * (`INCR` + `PEXPIRE`) sin tocar las rutas. Es una defensa técnica contra abuso, no una regla comercial.
 */

export interface DecisionTasa {
  permitido: boolean;
  /** Segundos hasta que se reinicia la ventana (para `Retry-After`). */
  reintentarEnSeg: number;
}

export interface LimitadorTasa {
  consumir(clave: string, ahoraMs?: number): DecisionTasa;
}

export interface OpcionesLimitador {
  limite: number;
  ventanaMs: number;
  /** Tope de claves en memoria; al superarlo se purgan las ventanas vencidas (y si no basta, todas). */
  maxClaves?: number;
}

export function crearLimitadorMemoria({ limite, ventanaMs, maxClaves = 10_000 }: OpcionesLimitador): LimitadorTasa {
  const ventanas = new Map<string, { inicio: number; usados: number }>();
  return {
    consumir(clave, ahoraMs = Date.now()) {
      let v = ventanas.get(clave);
      if (!v || ahoraMs - v.inicio >= ventanaMs) {
        if (!v && ventanas.size >= maxClaves) {
          for (const [k, x] of ventanas) if (ahoraMs - x.inicio >= ventanaMs) ventanas.delete(k);
          if (ventanas.size >= maxClaves) ventanas.clear();
        }
        v = { inicio: ahoraMs, usados: 0 };
        ventanas.set(clave, v);
      }
      v.usados += 1;
      const reintentarEnSeg = Math.max(1, Math.ceil((v.inicio + ventanaMs - ahoraMs) / 1000));
      return { permitido: v.usados <= limite, reintentarEnSeg };
    },
  };
}

/** Entero positivo de una variable de entorno, o el valor por defecto. */
export function enteroEnv(valor: string | undefined, porDefecto: number): number {
  const n = valor === undefined ? NaN : Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : porDefecto;
}

/**
 * IP del cliente. Nginx fija `X-Real-IP` con `$remote_addr` (no la manda el navegador); `X-Forwarded-For`
 * solo como respaldo y tomando el primer salto.
 */
export function ipCliente(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff ? xff.slice(0, 64) : 'desconocida';
}
