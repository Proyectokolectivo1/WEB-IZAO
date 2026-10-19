/**
 * Dinero de Izao (regla 1 de CLAUDE.md, §6.1 y §11.2.6 de la especificación).
 *
 * - Todo monto es `bigint` en la unidad menor de su moneda (COP exponente 0, USD exponente 2).
 * - Nunca se usa `float` ni `Number` para operar dinero. `Number` solo aparece en
 *   `toSafeNumber` (para APIs externas que exigen número) y en `fromDbAmount`
 *   (porque los tipos generados de Supabase tipan `bigint` como `number`, hallazgo B3).
 * - Redondeo: medio hacia arriba (simétrico: el medio se aleja de cero).
 */

export type CurrencyCode = 'COP' | 'USD';
export type CountryCode = 'CO' | 'EC';

/** Decimales de la unidad menor. Coincide con `currencies.exponent` del seed. */
export const CURRENCY_EXPONENT: Readonly<Record<CurrencyCode, number>> = Object.freeze({
  COP: 0,
  USD: 2,
});

/** Moneda de cada país (§2). */
export const COUNTRY_CURRENCY: Readonly<Record<CountryCode, CurrencyCode>> = Object.freeze({
  CO: 'COP',
  EC: 'USD',
});

/** Locale de formato de cada moneda (es-CO / es-EC). */
const CURRENCY_LOCALE: Readonly<Record<CurrencyCode, string>> = Object.freeze({
  COP: 'es-CO',
  USD: 'es-EC',
});

export interface Money {
  /** Monto en unidad menor. */
  readonly amount: bigint;
  readonly currency: CurrencyCode;
}

export type MoneyErrorCode =
  | 'NOT_BIGINT'
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'DIVISION_BY_ZERO'
  | 'UNSAFE_NUMBER'
  | 'INVALID_AMOUNT'
  | 'INVALID_ALLOCATION';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === 'COP' || value === 'USD';
}

function assertBigint(value: unknown, what: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new MoneyError('NOT_BIGINT', `${what} debe ser bigint (recibido ${typeof value}).`);
  }
}

function assertCurrency(value: unknown): asserts value is CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new MoneyError('UNKNOWN_CURRENCY', `Moneda no soportada: ${String(value)}.`);
  }
}

export function money(amount: bigint, currency: CurrencyCode): Money {
  assertBigint(amount, 'El monto');
  assertCurrency(currency);
  return Object.freeze({ amount, currency });
}

export function zero(currency: CurrencyCode): Money {
  return money(0n, currency);
}

export function currencyForCountry(country: CountryCode): CurrencyCode {
  const c = COUNTRY_CURRENCY[country];
  if (!c) throw new MoneyError('UNKNOWN_CURRENCY', `País sin moneda: ${String(country)}.`);
  return c;
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      'CURRENCY_MISMATCH',
      `No se pueden combinar montos de moneda distinta (${a.currency} y ${b.currency}).`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  let total = 0n;
  for (const m of items) {
    if (m.currency !== currency) {
      throw new MoneyError(
        'CURRENCY_MISMATCH',
        `La lista tiene un monto en ${m.currency} y se esperaba ${currency}.`,
      );
    }
    total += m.amount;
  }
  return money(total, currency);
}

/** Multiplica por un entero (cantidad). */
export function multiply(m: Money, factor: bigint): Money {
  assertBigint(factor, 'El factor');
  return money(m.amount * factor, m.currency);
}

export function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}

export function isZero(m: Money): boolean {
  return m.amount === 0n;
}

export function isNegative(m: Money): boolean {
  return m.amount < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/**
 * División entera con redondeo medio hacia arriba (el medio se aleja de cero).
 * `roundHalfUpDiv(5n, 2n) = 3n`, `roundHalfUpDiv(-5n, 2n) = -3n`.
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  assertBigint(numerator, 'El numerador');
  assertBigint(denominator, 'El denominador');
  if (denominator === 0n) throw new MoneyError('DIVISION_BY_ZERO', 'División por cero.');
  const negative = numerator < 0n !== denominator < 0n;
  const n = absBig(numerator);
  const d = absBig(denominator);
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** Porcentaje entero (p. ej. 10n = 10 %), redondeo medio hacia arriba. */
export function percentOf(m: Money, pct: bigint): Money {
  assertBigint(pct, 'El porcentaje');
  return money(roundHalfUpDiv(m.amount * pct, 100n), m.currency);
}

/** Porcentaje en centésimas (1050n = 10,50 %), redondeo medio hacia arriba. */
export function percentOfHundredths(m: Money, hundredths: bigint): Money {
  assertBigint(hundredths, 'El porcentaje');
  return money(roundHalfUpDiv(m.amount * hundredths, 10_000n), m.currency);
}

/**
 * Prorrateo exacto de `total` en proporción a `weights` (Σ partes = total, siempre).
 *
 * 1. Cada parte recibe `floor(|total| × peso / Σ pesos)`.
 * 2. El residuo va a la línea de mayor peso (empate: la de menor índice). Si
 *    `|total| ≤ Σ pesos`, ninguna parte supera su peso: el residuo que no quepa en la
 *    línea mayor pasa a la siguiente de mayor peso, y así sucesivamente.
 * 3. Un total negativo se prorratea por magnitud y conserva el signo.
 *
 * Determinista: el mismo carrito da siempre el mismo reparto.
 */
export function allocate(total: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError('INVALID_ALLOCATION', 'No hay líneas para prorratear.');
  }
  let weightSum = 0n;
  for (const w of weights) {
    assertBigint(w, 'El peso');
    if (w < 0n) throw new MoneyError('INVALID_ALLOCATION', 'Los pesos no pueden ser negativos.');
    weightSum += w;
  }
  if (total.amount === 0n) return weights.map(() => zero(total.currency));
  if (weightSum === 0n) {
    throw new MoneyError('INVALID_ALLOCATION', 'No se puede prorratear un monto sobre pesos en cero.');
  }

  const sign = total.amount < 0n ? -1n : 1n;
  const magnitude = absBig(total.amount);
  const parts = weights.map((w) => (magnitude * w) / weightSum);
  let residual = magnitude - parts.reduce((a, p) => a + p, 0n);

  // Orden: mayor peso primero; empate por menor índice.
  const order = weights
    .map((w, i) => ({ w, i }))
    .filter((x) => x.w > 0n)
    .sort((a, b) => (a.w === b.w ? a.i - b.i : a.w > b.w ? -1 : 1));

  const capped = magnitude <= weightSum;
  for (const { w, i } of order) {
    if (residual === 0n) break;
    const current = parts[i]!;
    const room = capped ? w - current : residual;
    const give = room < residual ? room : residual;
    parts[i] = current + give;
    residual -= give;
  }
  if (residual !== 0n) {
    // Inalcanzable por construcción; se deja como defensa.
    throw new MoneyError('INVALID_ALLOCATION', 'El prorrateo no cuadró.');
  }
  return parts.map((p) => money(p * sign, total.currency));
}

/** Convierte a `Number` solo si es un entero seguro (para APIs que exigen número). */
export function toSafeNumber(amount: bigint): number {
  assertBigint(amount, 'El monto');
  const n = Number(amount);
  if (!Number.isSafeInteger(n) || BigInt(n) !== amount) {
    throw new MoneyError(
      'UNSAFE_NUMBER',
      `El monto ${amount.toString()} no cabe en un entero seguro de JavaScript.`,
    );
  }
  return n;
}

/**
 * Lee un monto de la base. Los tipos generados de Supabase dan `number` para columnas
 * `bigint` (hallazgo B3): se acepta `number` solo si es entero seguro; `string` solo si
 * son dígitos enteros. Nada de decimales ni notación científica.
 */
export function fromDbAmount(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(
        'UNSAFE_NUMBER',
        `Monto de base no entero o inseguro: ${String(value)}. Lee la columna como texto.`,
      );
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new MoneyError('INVALID_AMOUNT', `Monto de base inválido: ${String(value)}.`);
}

/** Representación decimal exacta en unidad mayor con punto: `99.82`, `90000`, `-0.05`. */
export function toDecimalString(m: Money): string {
  const exp = CURRENCY_EXPONENT[m.currency];
  const negative = m.amount < 0n;
  const digits = absBig(m.amount).toString();
  if (exp === 0) return (negative ? '-' : '') + digits;
  const padded = digits.padStart(exp + 1, '0');
  const int = padded.slice(0, padded.length - exp);
  const frac = padded.slice(padded.length - exp);
  return `${negative ? '-' : ''}${int}.${frac}`;
}

/**
 * Convierte texto en unidad mayor (`"49.90"`) a `Money` sin pasar por `float`.
 * Solo admite punto como separador decimal y como máximo `exponent` decimales.
 */
export function fromMajorString(value: string, currency: CurrencyCode): Money {
  assertCurrency(currency);
  const exp = CURRENCY_EXPONENT[currency];
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new MoneyError('INVALID_AMOUNT', `Monto inválido: "${value}".`);
  const [, sign, int, frac = ''] = match;
  if (frac.length > exp) {
    throw new MoneyError(
      'INVALID_AMOUNT',
      `"${value}" tiene más decimales de los que admite ${currency} (${exp}).`,
    );
  }
  const minor = BigInt(int! + frac.padEnd(exp, '0'));
  return money(sign === '-' ? -minor : minor, currency);
}

/**
 * Formato para mostrar: COP con `es-CO` (`$ 90.000`), USD con `es-EC` (`$99,82`).
 * Usa la representación decimal en texto, así que no hay pérdida de precisión.
 */
export function formatMoney(m: Money, locale?: string): string {
  const exp = CURRENCY_EXPONENT[m.currency];
  const nf = new Intl.NumberFormat(locale ?? CURRENCY_LOCALE[m.currency], {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  // Intl.NumberFormat acepta cadenas decimales exactas (ES2023, StringNumericLiteral).
  return nf.format(toDecimalString(m) as `${number}`);
}
