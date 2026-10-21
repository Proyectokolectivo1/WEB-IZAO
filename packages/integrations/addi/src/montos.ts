/**
 * Montos de Addi: texto con "centavos de peso separados por `.`" (ejemplos oficiales `"255000.0"`). La base
 * guarda COP con exponente 0 (`bigint`), así que solo se envían y aceptan pesos enteros: centavos ≠ 0 → `null`.
 * Sin `float` en ningún punto.
 */
const PATRON = /^(\d{1,18})(?:\.(\d{1,2}))?$/;

export function montoAddi(pesos: bigint): string {
  if (pesos < 0n) throw new RangeError('Monto negativo.');
  return `${pesos.toString()}.0`;
}

export function parseMontoAddi(v: unknown): bigint | null {
  if (typeof v === 'number') {
    return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  }
  if (typeof v !== 'string') return null;
  const m = PATRON.exec(v);
  if (!m) return null;
  if (m[2] !== undefined && /[^0]/.test(m[2])) return null;
  return BigInt(m[1] as string);
}
