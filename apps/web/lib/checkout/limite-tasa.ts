/**
 * Límite de peticiones por cliente (§26.1). Ventana fija por clave.
 *
 * PROVISIONAL: vive en la memoria del proceso de `apps/web` (con 2 réplicas el límite efectivo se duplica).
 * Cuando exista el cliente Redis compartido (pendiente técnico de izao-infra), se implementa `LimitadorTasa`
 * sobre Redis (`INCR` + `PEXPIRE`) sin tocar las rutas. Es una defensa técnica contra abuso, no una regla
 * comercial.
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
  /**
   * Tope de claves en memoria. Al llegar a él se purgan las ventanas vencidas y, si no basta, se expulsan solo
   * las más antiguas (nunca se vacía todo: eso le reiniciaría el conteo a quien está abusando).
   */
  maxClaves?: number;
}

export function crearLimitadorMemoria({
  limite,
  ventanaMs,
  maxClaves = 10_000,
}: OpcionesLimitador): LimitadorTasa & { tamano(): number } {
  // El orden de inserción del Map es el orden de inicio de ventana: al renovar, la clave se reinserta al final.
  const ventanas = new Map<string, { inicio: number; usados: number }>();

  function hacerEspacio(ahoraMs: number): void {
    for (const [k, x] of ventanas) if (ahoraMs - x.inicio >= ventanaMs) ventanas.delete(k);
    for (const k of ventanas.keys()) {
      if (ventanas.size < maxClaves) break;
      ventanas.delete(k);
    }
  }

  return {
    consumir(clave, ahoraMs = Date.now()) {
      let v = ventanas.get(clave);
      if (!v || ahoraMs - v.inicio >= ventanaMs) {
        if (v) ventanas.delete(clave);
        else if (ventanas.size >= maxClaves) hacerEspacio(ahoraMs);
        v = { inicio: ahoraMs, usados: 0 };
        ventanas.set(clave, v);
      }
      v.usados += 1;
      const reintentarEnSeg = Math.max(1, Math.ceil((v.inicio + ventanaMs - ahoraMs) / 1000));
      return { permitido: v.usados <= limite, reintentarEnSeg };
    },
    tamano: () => ventanas.size,
  };
}

/** Entero positivo de una variable de entorno, o el valor por defecto. */
export function enteroEnv(valor: string | undefined, porDefecto: number): number {
  const n = valor === undefined ? NaN : Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : porDefecto;
}

/** IPv4 o IPv6 (forma, no validación completa): evita usar basura como clave. */
const FORMA_IP = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * IP del cliente. En producción solo vale `X-Real-IP`, que Nginx fija con `$remote_addr`
 * (`infra/nginx/izao-proxy.conf`; `web` solo escucha en 127.0.0.1); `X-Forwarded-For` lo puede escribir el
 * navegador y no se usa. Sin `X-Real-IP` válida, todas esas peticiones comparten una clave (falla cerrada).
 * Fuera de producción se acepta el primer salto de `X-Forwarded-For` como respaldo.
 */
export function ipCliente(headers: Headers, produccion = process.env.NODE_ENV === 'production'): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real && FORMA_IP.test(real)) return real;
  if (produccion) return 'sin-x-real-ip';
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff && FORMA_IP.test(xff) ? xff : 'desconocida';
}
