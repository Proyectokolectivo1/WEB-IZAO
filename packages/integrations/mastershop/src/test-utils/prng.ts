/**
 * Generador pseudoaleatorio con semilla (mulberry32) para pruebas de propiedad
 * deterministas: la misma semilla produce siempre los mismos casos.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    big(min: bigint, max: bigint): bigint {
      const span = max - min + 1n;
      // Dos tramos de 26 bits bastan para los rangos de las pruebas (< 2^52).
      const hi = BigInt(Math.floor(next() * 2 ** 26));
      const lo = BigInt(Math.floor(next() * 2 ** 26));
      return min + (((hi << 26n) | lo) % span);
    },
    pick<T>(values: readonly T[]): T {
      const v = values[Math.floor(next() * values.length)];
      if (v === undefined) throw new Error('pick sobre lista vacía');
      return v;
    },
  };
}

export interface Rng {
  int(min: number, max: number): number;
  big(min: bigint, max: bigint): bigint;
  pick<T>(values: readonly T[]): T;
}
