import { describe, expect, it } from 'vitest';
import { montoAddi, parseMontoAddi } from './montos';

describe('montos de Addi: texto con centavos separados por "." (COP, exponente 0)', () => {
  it('formatea pesos enteros como "N.0" (forma de los ejemplos oficiales)', () => {
    expect(montoAddi(99_000n)).toBe('99000.0');
    expect(montoAddi(231_000n)).toBe('231000.0');
    expect(montoAddi(0n)).toBe('0.0');
  });

  it('rechaza negativos', () => {
    expect(() => montoAddi(-1n)).toThrow(RangeError);
  });

  it('lee "150000.0", "150000", "150000.00" y número entero como 150000', () => {
    expect(parseMontoAddi('150000.0')).toBe(150_000n);
    expect(parseMontoAddi('150000')).toBe(150_000n);
    expect(parseMontoAddi('150000.00')).toBe(150_000n);
    expect(parseMontoAddi(150000)).toBe(150_000n);
  });

  it('no acepta centavos distintos de cero, negativos, notación científica ni basura', () => {
    for (const v of ['150000.5', '150000.01', '-1', '1e5', '', 'abc', '1.000', ' 1', 1.5, Number.NaN, null, undefined, {}]) {
      expect(parseMontoAddi(v as never), String(v)).toBeNull();
    }
  });

  it('no acepta números fuera del rango seguro', () => {
    expect(parseMontoAddi(2 ** 60)).toBeNull();
    expect(parseMontoAddi('9007199254740993')).toBe(9_007_199_254_740_993n);
  });
});
