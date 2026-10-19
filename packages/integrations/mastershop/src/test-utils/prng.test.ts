import { describe, expect, it } from 'vitest';
import { createRng } from './prng';

describe('createRng', () => {
  it('es determinista con la misma semilla', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.big(0n, 1_000_000n));
    const seqB = Array.from({ length: 20 }, () => b.big(0n, 1_000_000n));
    expect(seqA).toEqual(seqB);
  });

  it('respeta los rangos', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1_000; i++) {
      const n = rng.int(1, 5);
      expect(n >= 1 && n <= 5).toBe(true);
      const b = rng.big(10n, 20n);
      expect(b >= 10n && b <= 20n).toBe(true);
    }
  });
});
