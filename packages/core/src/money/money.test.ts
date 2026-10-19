import { describe, expect, it } from 'vitest';
import {
  CURRENCY_EXPONENT,
  MoneyError,
  add,
  allocate,
  assertSameCurrency,
  compare,
  currencyForCountry,
  equals,
  formatMoney,
  fromDbAmount,
  fromMajorString,
  isNegative,
  isZero,
  max,
  min,
  money,
  multiply,
  negate,
  percentOf,
  percentOfHundredths,
  roundHalfUpDiv,
  subtract,
  sum,
  toDecimalString,
  toSafeNumber,
  zero,
} from './index';

/** Normaliza espacios no separables que usa Intl. */
const plano = (s: string) => s.replace(/\s/g, ' ');

describe('money: construcción y exponentes', () => {
  it('COP tiene exponente 0 y USD exponente 2', () => {
    expect(CURRENCY_EXPONENT.COP).toBe(0);
    expect(CURRENCY_EXPONENT.USD).toBe(2);
  });

  it('crea montos en unidad menor con bigint', () => {
    const m = money(90_000n, 'COP');
    expect(m).toEqual({ amount: 90_000n, currency: 'COP' });
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('rechaza montos que no son bigint (nunca Number para dinero)', () => {
    // @ts-expect-error se prueba la defensa en tiempo de ejecución
    expect(() => money(90000, 'COP')).toThrow(MoneyError);
    // @ts-expect-error se prueba la defensa en tiempo de ejecución
    expect(() => money(49.9, 'USD')).toThrow(MoneyError);
  });

  it('rechaza monedas desconocidas', () => {
    // @ts-expect-error moneda no soportada
    expect(() => money(1n, 'EUR')).toThrow(MoneyError);
  });

  it('zero, isZero, isNegative', () => {
    expect(isZero(zero('USD'))).toBe(true);
    expect(isNegative(money(-1n, 'COP'))).toBe(true);
    expect(isNegative(zero('COP'))).toBe(false);
  });

  it('moneda por país: CO → COP, EC → USD', () => {
    expect(currencyForCountry('CO')).toBe('COP');
    expect(currencyForCountry('EC')).toBe('USD');
  });
});

describe('money: aritmética', () => {
  it('suma y resta en la misma moneda', () => {
    expect(add(money(90_000n, 'COP'), money(120_000n, 'COP')).amount).toBe(210_000n);
    expect(subtract(money(90_000n, 'COP'), money(100_000n, 'COP')).amount).toBe(-10_000n);
  });

  it('rechaza mezclar monedas', () => {
    expect(() => add(money(1n, 'COP'), money(1n, 'USD'))).toThrow(MoneyError);
    expect(() => assertSameCurrency(money(1n, 'COP'), money(1n, 'USD'))).toThrow(/moneda/i);
  });

  it('sum de una lista, con moneda explícita para la lista vacía', () => {
    expect(sum([], 'COP')).toEqual(zero('COP'));
    expect(sum([money(4_990n, 'USD'), money(4_990n, 'USD')], 'USD').amount).toBe(9_980n);
    expect(() => sum([money(1n, 'COP')], 'USD')).toThrow(MoneyError);
  });

  it('multiplica solo por enteros bigint', () => {
    expect(multiply(money(4_990n, 'USD'), 2n).amount).toBe(9_980n);
    expect(multiply(money(90_000n, 'COP'), 0n).amount).toBe(0n);
    expect(multiply(money(90_000n, 'COP'), -3n).amount).toBe(-270_000n);
    // @ts-expect-error factor Number no permitido
    expect(() => multiply(money(1n, 'COP'), 1.5)).toThrow(MoneyError);
  });

  it('negate, compare, equals, min, max', () => {
    expect(negate(money(5n, 'COP')).amount).toBe(-5n);
    expect(compare(money(1n, 'COP'), money(2n, 'COP'))).toBe(-1);
    expect(compare(money(2n, 'COP'), money(2n, 'COP'))).toBe(0);
    expect(equals(money(2n, 'COP'), money(2n, 'COP'))).toBe(true);
    expect(equals(money(2n, 'COP'), money(2n, 'USD'))).toBe(false);
    expect(min(money(3n, 'COP'), money(2n, 'COP')).amount).toBe(2n);
    expect(max(money(3n, 'COP'), money(2n, 'COP')).amount).toBe(3n);
  });

  it('soporta montos enormes sin pérdida', () => {
    const enorme = money(9_007_199_254_740_993_000_000n, 'COP');
    expect(add(enorme, money(7n, 'COP')).amount).toBe(9_007_199_254_740_993_000_007n);
    expect(multiply(enorme, 1_000n).amount).toBe(9_007_199_254_740_993_000_000_000n);
  });
});

describe('money: redondeo medio hacia arriba', () => {
  it('roundHalfUpDiv con positivos', () => {
    expect(roundHalfUpDiv(5n, 2n)).toBe(3n); // 2,5 → 3
    expect(roundHalfUpDiv(7n, 3n)).toBe(2n); // 2,33 → 2
    expect(roundHalfUpDiv(8n, 3n)).toBe(3n); // 2,67 → 3
    expect(roundHalfUpDiv(4n, 2n)).toBe(2n);
    expect(roundHalfUpDiv(0n, 7n)).toBe(0n);
  });

  it('roundHalfUpDiv con negativos es simétrico (medio se aleja de cero)', () => {
    expect(roundHalfUpDiv(-5n, 2n)).toBe(-3n);
    expect(roundHalfUpDiv(-7n, 3n)).toBe(-2n);
    expect(roundHalfUpDiv(5n, -2n)).toBe(-3n);
  });

  it('roundHalfUpDiv rechaza división por cero', () => {
    expect(() => roundHalfUpDiv(1n, 0n)).toThrow(MoneyError);
  });

  it('percentOf: 10 % de 90.000 COP = 9.000', () => {
    expect(percentOf(money(90_000n, 'COP'), 10n).amount).toBe(9_000n);
  });

  it('percentOf: 10 % de USD 99,80 = 9,98 (998 centavos)', () => {
    expect(percentOf(money(9_980n, 'USD'), 10n).amount).toBe(998n);
  });

  it('percentOf redondea medio hacia arriba: 15 % de USD 0,10 = 0,015 → 0,02', () => {
    expect(percentOf(money(10n, 'USD'), 15n).amount).toBe(2n);
    // 15 % de 0,09 = 0,0135 → 0,01
    expect(percentOf(money(9n, 'USD'), 15n).amount).toBe(1n);
  });

  it('percentOf: 1 % de 50 COP = 0,5 → 1', () => {
    expect(percentOf(money(50n, 'COP'), 1n).amount).toBe(1n);
    expect(percentOf(money(49n, 'COP'), 1n).amount).toBe(0n);
  });

  it('percentOfHundredths: 10,50 % de 100.000 COP = 10.500', () => {
    expect(percentOfHundredths(money(100_000n, 'COP'), 1_050n).amount).toBe(10_500n);
  });

  it('percentOf rechaza porcentaje Number', () => {
    // @ts-expect-error porcentaje Number no permitido
    expect(() => percentOf(money(1n, 'COP'), 10)).toThrow(MoneyError);
  });
});

describe('money: prorrateo exacto', () => {
  it('caso 10 de §11.3: 15.000 entre 90.000 y 60.000 → 9.000 y 6.000', () => {
    const r = allocate(money(15_000n, 'COP'), [90_000n, 60_000n]);
    expect(r.map((m) => m.amount)).toEqual([9_000n, 6_000n]);
  });

  it('caso 10 de §14.4: reducción 25.000 entre 90.000 y 60.000 → 15.000 y 10.000', () => {
    const r = allocate(money(25_000n, 'COP'), [90_000n, 60_000n]);
    expect(r.map((m) => m.amount)).toEqual([15_000n, 10_000n]);
  });

  it('el residuo va a la línea de mayor valor', () => {
    // 100 entre 3 líneas iguales salvo la del medio: 33/34/33
    const r = allocate(money(100n, 'COP'), [10n, 11n, 10n]);
    expect(r.map((m) => m.amount)).toEqual([32n, 36n, 32n]);
    expect(r.reduce((a, m) => a + m.amount, 0n)).toBe(100n);
  });

  it('empate de mayor valor: el residuo va a la primera (determinista)', () => {
    const r = allocate(money(10n, 'COP'), [1n, 1n, 1n]);
    expect(r.map((m) => m.amount)).toEqual([4n, 3n, 3n]);
  });

  it('la suma siempre es exacta y ninguna parte supera su peso cuando total ≤ Σ pesos', () => {
    const pesos = [1n, 1n, 1n, 1n, 1n];
    const r = allocate(money(4n, 'COP'), pesos);
    expect(r.reduce((a, m) => a + m.amount, 0n)).toBe(4n);
    r.forEach((m, i) => expect(m.amount <= pesos[i]!).toBe(true));
  });

  it('pesos en cero reciben cero', () => {
    const r = allocate(money(1_000n, 'COP'), [0n, 500n, 0n]);
    expect(r.map((m) => m.amount)).toEqual([0n, 1_000n, 0n]);
  });

  it('total cero da ceros, aun con pesos en cero', () => {
    expect(allocate(money(0n, 'COP'), [0n, 0n]).map((m) => m.amount)).toEqual([0n, 0n]);
  });

  it('total negativo se prorratea con el mismo signo', () => {
    const r = allocate(money(-15_000n, 'COP'), [90_000n, 60_000n]);
    expect(r.map((m) => m.amount)).toEqual([-9_000n, -6_000n]);
  });

  it('rechaza pesos negativos, lista vacía y total sin pesos', () => {
    expect(() => allocate(money(1n, 'COP'), [-1n, 2n])).toThrow(MoneyError);
    expect(() => allocate(money(1n, 'COP'), [])).toThrow(MoneyError);
    expect(() => allocate(money(1n, 'COP'), [0n, 0n])).toThrow(MoneyError);
  });

  it('montos enormes se prorratean exacto', () => {
    const total = money(10n ** 30n + 1n, 'USD');
    const r = allocate(total, [3n, 7n]);
    expect(r[0]!.amount + r[1]!.amount).toBe(10n ** 30n + 1n);
  });
});

describe('money: conversiones seguras', () => {
  it('toSafeNumber convierte solo enteros seguros', () => {
    expect(toSafeNumber(90_000n)).toBe(90_000);
    expect(toSafeNumber(-5n)).toBe(-5);
    expect(toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(MoneyError);
    expect(() => toSafeNumber(BigInt(Number.MIN_SAFE_INTEGER) - 1n)).toThrow(MoneyError);
  });

  it('fromDbAmount acepta bigint, string entero y number entero seguro (tipos generados, B3)', () => {
    expect(fromDbAmount(90_000n)).toBe(90_000n);
    expect(fromDbAmount('9007199254740993')).toBe(9_007_199_254_740_993n);
    expect(fromDbAmount(90_000)).toBe(90_000n);
    expect(fromDbAmount('-12')).toBe(-12n);
  });

  it('fromDbAmount rechaza decimales, inseguros y basura', () => {
    expect(() => fromDbAmount(49.9)).toThrow(MoneyError);
    expect(() => fromDbAmount(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
    expect(() => fromDbAmount('49.90')).toThrow(MoneyError);
    expect(() => fromDbAmount('1e5')).toThrow(MoneyError);
    expect(() => fromDbAmount('')).toThrow(MoneyError);
    expect(() => fromDbAmount(Number.NaN)).toThrow(MoneyError);
  });

  it('toDecimalString respeta el exponente', () => {
    expect(toDecimalString(money(90_000n, 'COP'))).toBe('90000');
    expect(toDecimalString(money(9_982n, 'USD'))).toBe('99.82');
    expect(toDecimalString(money(5n, 'USD'))).toBe('0.05');
    expect(toDecimalString(money(-5n, 'USD'))).toBe('-0.05');
    expect(toDecimalString(money(0n, 'USD'))).toBe('0.00');
  });

  it('fromMajorString convierte texto en unidad mayor sin float', () => {
    expect(fromMajorString('49.90', 'USD').amount).toBe(4_990n);
    expect(fromMajorString('49.9', 'USD').amount).toBe(4_990n);
    expect(fromMajorString('49', 'USD').amount).toBe(4_900n);
    expect(fromMajorString('90000', 'COP').amount).toBe(90_000n);
    expect(fromMajorString('-0.05', 'USD').amount).toBe(-5n);
  });

  it('fromMajorString rechaza más decimales que el exponente y formatos ambiguos', () => {
    expect(() => fromMajorString('49.999', 'USD')).toThrow(MoneyError);
    expect(() => fromMajorString('90000.5', 'COP')).toThrow(MoneyError);
    expect(() => fromMajorString('90.000', 'COP')).toThrow(MoneyError);
    expect(() => fromMajorString('1,5', 'USD')).toThrow(MoneyError);
    expect(() => fromMajorString('abc', 'USD')).toThrow(MoneyError);
  });
});

describe('money: formato es-CO / es-EC', () => {
  it('COP sin decimales con punto de miles', () => {
    expect(plano(formatMoney(money(90_000n, 'COP')))).toBe('$ 90.000');
    expect(plano(formatMoney(money(-90_000n, 'COP')))).toBe('-$ 90.000');
    expect(plano(formatMoney(money(0n, 'COP')))).toBe('$ 0');
  });

  it('USD con dos decimales en es-EC', () => {
    expect(plano(formatMoney(money(9_982n, 'USD')))).toBe('$99,82');
    expect(plano(formatMoney(money(123_456_705n, 'USD')))).toBe('$1.234.567,05');
    expect(plano(formatMoney(money(5n, 'USD')))).toBe('$0,05');
  });

  it('formatea montos enormes sin pérdida de precisión', () => {
    expect(plano(formatMoney(money(123_456_789_012_345_678_901n, 'COP')))).toBe(
      '$ 123.456.789.012.345.678.901',
    );
  });
});
