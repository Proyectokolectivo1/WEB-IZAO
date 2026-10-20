import { describe, expect, it } from 'vitest';
import { comisionPasarela, parsePercentThousandths } from './comision';

describe('parsePercentThousandths (numeric(6,3) del panel, sin float)', () => {
  it('convierte texto o número a milésimas exactas', () => {
    expect(parsePercentThousandths('2.65')).toBe(2650n);
    expect(parsePercentThousandths('2.650')).toBe(2650n);
    expect(parsePercentThousandths(19)).toBe(19000n);
    expect(parsePercentThousandths('0')).toBe(0n);
    expect(parsePercentThousandths('0.125')).toBe(125n);
  });
  it('rechaza negativos, más de 3 decimales y basura', () => {
    expect(parsePercentThousandths('-1')).toBeNull();
    expect(parsePercentThousandths('1.2345')).toBeNull();
    expect(parsePercentThousandths('abc')).toBeNull();
    expect(parsePercentThousandths(Number.NaN)).toBeNull();
    expect(parsePercentThousandths(null)).toBeNull();
  });
});

describe('comisionPasarela (§12.2: fee_pct + fee_fixed + IVA sobre la comisión)', () => {
  const WOMPI = { fee_pct: '2.65', fee_fixed: 700n, fee_tax_pct: '19' };

  it('valor de referencia: 100.000 COP → (2.650 + 700) × 1,19 = 3.986,5 → 3.987', () => {
    expect(comisionPasarela(100_000n, WOMPI)).toBe(3_987n);
  });

  it('monto grande sin pérdida de precisión', () => {
    // 9.999.999.999 × 2,65 % = 264.999.999,97 → + 700 → × 1,19 = 315.350.832,96... → 315.350.833
    expect(comisionPasarela(9_999_999_999n, WOMPI)).toBe(315_350_833n);
  });

  it('sin porcentajes ni fijo, la comisión es 0', () => {
    expect(comisionPasarela(250_000n, { fee_pct: '0', fee_fixed: 0n, fee_tax_pct: '0' })).toBe(0n);
  });

  it('solo fijo con IVA', () => {
    expect(comisionPasarela(1n, { fee_pct: '0', fee_fixed: 700n, fee_tax_pct: '19' })).toBe(833n);
  });

  it('configuración inválida lanza', () => {
    expect(() => comisionPasarela(100n, { fee_pct: 'x', fee_fixed: 0n, fee_tax_pct: '0' })).toThrow();
    expect(() => comisionPasarela(-1n, WOMPI)).toThrow();
    expect(() => comisionPasarela(100n, { ...WOMPI, fee_fixed: -1n })).toThrow();
  });
});
