/**
 * Firmas de Wompi (docs.wompi.co, verificado el 2026-10-20, ver D-024):
 * - Integridad del Web Checkout: `SHA256(referencia + monto_en_centavos + moneda [+ expiración] + secreto)`.
 * - Checksum de eventos: valores de `signature.properties` (en orden) + `timestamp` + secreto de eventos.
 * Se calculan solo en el servidor. Nunca se registra la cadena concatenada (contiene el secreto).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export interface DatosIntegridad {
  referencia: string;
  montoEnCentavos: bigint;
  moneda: string;
  /** ISO 8601 UTC exacto que también va en `expiration-time` (p. ej. `2023-06-09T20:28:50.000Z`). */
  expiracion?: string | null;
  secretoIntegridad: string;
}

function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function firmaIntegridad(d: DatosIntegridad): string {
  if (!d.referencia) throw new RangeError('Referencia vacía.');
  if (typeof d.montoEnCentavos !== 'bigint' || d.montoEnCentavos <= 0n) throw new RangeError('Monto inválido.');
  if (!d.moneda) throw new RangeError('Moneda vacía.');
  if (!d.secretoIntegridad) throw new RangeError('Falta el secreto de integridad.');
  return sha256Hex(`${d.referencia}${d.montoEnCentavos.toString()}${d.moneda}${d.expiracion ?? ''}${d.secretoIntegridad}`);
}

/** `valores` ya resueltos desde `data` en el orden de `signature.properties`. */
export function checksumEvento(valores: readonly string[], timestamp: number, secretoEventos: string): string {
  if (!secretoEventos) throw new RangeError('Falta el secreto de eventos.');
  return sha256Hex(`${valores.join('')}${String(timestamp)}${secretoEventos}`);
}

/** Compara dos hex en tiempo constante, sin distinguir mayúsculas. */
export function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), 'utf8');
  const y = Buffer.from(b.toLowerCase(), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
