/**
 * Valor y líneas del pedido que se envían a MasterShop (§14.4).
 *
 * MasterShop exige `order_transaction.total === Σ price × quantity + Σ additional_charge.value`
 * EXACTO. Esta función es pura, trabaja solo con `bigint` en unidad menor y garantiza esa
 * igualdad, que ningún precio unitario es negativo y que el total es positivo.
 */
import { allocate, money } from '@izao/core/money';
import type { CurrencyCode } from '@izao/core/money';

/** Método de pago del pedido interno, en lo que importa a MasterShop. */
export type CarrierPaymentKind = 'cod' | 'wompi' | 'addi' | 'sistecredito';

/**
 * Modo de cuadre del total (`country_settings.carrier_discount_mode`, D-010):
 * - `additional_charge` (Opción A): precios reales y un cargo negativo "descuento".
 * - `prorate` (Opción B): cada línea va a su valor menos su `line_discount`, y el abono
 *   se reparte sobre el valor neto de las líneas.
 */
export type CarrierDiscountMode = 'additional_charge' | 'prorate';

/** `payment_method` de MasterShop: `cod` contra entrega, `pia` ya pagado. */
export type CarrierPaymentMethod = 'cod' | 'pia';

/** Lo mínimo que se necesita de cada línea del pedido. */
export interface CarrierLineSource {
  /** Precio unitario en unidad menor. */
  unitPrice: bigint;
  /** Unidades (entero > 0). */
  quantity: number;
  /** Descuento asignado a la línea completa (`order_items.line_discount`). */
  lineDiscount: bigint;
}

export interface BuildCarrierLinesInput<T extends CarrierLineSource> {
  currency: CurrencyCode;
  paymentKind: CarrierPaymentKind;
  mode: CarrierDiscountMode;
  items: readonly T[];
  /** Abono pagado por adelantado; obligatorio en contra entrega y prohibido en los demás. */
  codDeposit?: bigint | undefined;
}

export interface CarrierLine<T> {
  source: T;
  /** Índice de la línea de origen en `items`. */
  sourceIndex: number;
  quantity: number;
  /** Precio unitario a enviar, en unidad menor. */
  price: bigint;
}

/** Tipo de cargo del modo A. `[VERIFICAR]` contra MasterShop con un pedido de prueba. */
export const CARRIER_DISCOUNT_CHARGE_TYPE = 'descuento';

export interface CarrierAdditionalCharge {
  type_charge: typeof CARRIER_DISCOUNT_CHARGE_TYPE;
  /** Siempre negativo. */
  value: bigint;
}

export interface CarrierLines<T> {
  currency: CurrencyCode;
  paymentMethod: CarrierPaymentMethod;
  /** `order_transaction.total`. */
  total: bigint;
  subtotal: bigint;
  discount: bigint;
  codDeposit: bigint;
  /** Lo que se resta del subtotal para llegar al total (descuento + abono). */
  reduction: bigint;
  lines: CarrierLine<T>[];
  additionalCharges: CarrierAdditionalCharge[];
}

export type CarrierLinesErrorCode =
  | 'sin_lineas'
  | 'monto_invalido'
  | 'cantidad_invalida'
  | 'descuento_invalido'
  | 'descuento_no_permitido'
  | 'abono_requerido'
  | 'abono_no_permitido'
  | 'total_no_positivo'
  | 'modo_invalido';

export class CarrierLinesError extends Error {
  readonly code: CarrierLinesErrorCode;
  constructor(code: CarrierLinesErrorCode, message: string) {
    super(message);
    this.name = 'CarrierLinesError';
    this.code = code;
  }
}

function assertAmount(value: unknown, what: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new CarrierLinesError('monto_invalido', `${what} debe ser bigint en unidad menor.`);
  }
}

export function buildCarrierLines<T extends CarrierLineSource>(
  input: BuildCarrierLinesInput<T>,
): CarrierLines<T> {
  const { currency, paymentKind, mode, items } = input;
  if (mode !== 'prorate' && mode !== 'additional_charge') {
    throw new CarrierLinesError('modo_invalido', `Modo de cuadre desconocido: ${String(mode)}.`);
  }
  if (items.length === 0) {
    throw new CarrierLinesError('sin_lineas', 'El pedido no tiene líneas.');
  }

  let subtotal = 0n;
  let discount = 0n;
  const lineValues: bigint[] = [];
  items.forEach((it, i) => {
    assertAmount(it.unitPrice, `El precio de la línea ${i + 1}`);
    assertAmount(it.lineDiscount, `El descuento de la línea ${i + 1}`);
    if (!Number.isSafeInteger(it.quantity) || it.quantity <= 0) {
      throw new CarrierLinesError(
        'cantidad_invalida',
        `La cantidad de la línea ${i + 1} debe ser un entero positivo.`,
      );
    }
    if (it.unitPrice < 0n) {
      throw new CarrierLinesError('monto_invalido', `El precio de la línea ${i + 1} es negativo.`);
    }
    const value = it.unitPrice * BigInt(it.quantity);
    if (it.lineDiscount < 0n || it.lineDiscount > value) {
      throw new CarrierLinesError(
        'descuento_invalido',
        `El descuento de la línea ${i + 1} debe estar entre 0 y el valor de la línea.`,
      );
    }
    lineValues.push(value);
    subtotal += value;
    discount += it.lineDiscount;
  });

  const isCod = paymentKind === 'cod';
  const isFinancing = paymentKind === 'addi' || paymentKind === 'sistecredito';
  if (isFinancing && discount !== 0n) {
    throw new CarrierLinesError(
      'descuento_no_permitido',
      'Los códigos de descuento no aplican con Addi ni Sistecrédito (§11.2).',
    );
  }
  if (isCod && input.codDeposit === undefined) {
    throw new CarrierLinesError('abono_requerido', 'Contra entrega exige el valor del abono.');
  }
  if (!isCod && input.codDeposit !== undefined && input.codDeposit !== 0n) {
    throw new CarrierLinesError('abono_no_permitido', 'El abono solo existe en contra entrega.');
  }
  const codDeposit = isCod ? (input.codDeposit as bigint) : 0n;
  assertAmount(codDeposit, 'El abono');
  if (codDeposit < 0n) {
    throw new CarrierLinesError('monto_invalido', 'El abono no puede ser negativo.');
  }

  // §14.4: cod → (subtotal − descuento) − abono · Wompi → subtotal − descuento ·
  // Addi/Sistecrédito → subtotal (el recargo se queda en la tienda).
  const reduction = discount + codDeposit;
  const total = subtotal - reduction;
  if (total <= 0n) {
    throw new CarrierLinesError(
      'total_no_positivo',
      'El valor a enviar a MasterShop debe ser mayor que cero.',
    );
  }

  const paymentMethod: CarrierPaymentMethod = isCod ? 'cod' : 'pia';
  const base = { currency, paymentMethod, total, subtotal, discount, codDeposit, reduction };

  if (mode === 'additional_charge') {
    return {
      ...base,
      lines: items.map((source, sourceIndex) => ({
        source,
        sourceIndex,
        quantity: source.quantity,
        price: source.unitPrice,
      })),
      additionalCharges:
        reduction === 0n ? [] : [{ type_charge: CARRIER_DISCOUNT_CHARGE_TYPE, value: -reduction }],
    };
  }

  // Opción B (M1, §11.2: `line_discount` es la fuente para costos, reportes y MasterShop):
  // cada línea conserva su propio descuento; solo el abono se prorratea, en proporción al
  // valor NETO de cada línea, con residuo a la de mayor valor neto (empate: menor índice).
  // `allocate` nunca da a una línea más que su peso, así que ningún precio queda negativo.
  const netValues = items.map((it, i) => lineValues[i]! - it.lineDiscount);
  const depositShares =
    codDeposit === 0n
      ? netValues.map(() => 0n)
      : allocate(money(codDeposit, currency), netValues).map((m) => m.amount);

  const lines: CarrierLine<T>[] = [];
  items.forEach((source, sourceIndex) => {
    const lineTotal = netValues[sourceIndex]! - depositShares[sourceIndex]!;
    const qty = BigInt(source.quantity);
    if (lineTotal % qty === 0n) {
      lines.push({ source, sourceIndex, quantity: source.quantity, price: lineTotal / qty });
      return;
    }
    // No divide exacto por unidad: se parte en líneas de cantidad 1. Las primeras
    // `resto` unidades llevan un peso (o centavo) más.
    const unit = lineTotal / qty;
    const rest = lineTotal % qty;
    for (let u = 0n; u < qty; u++) {
      lines.push({ source, sourceIndex, quantity: 1, price: u < rest ? unit + 1n : unit });
    }
  });

  return { ...base, lines, additionalCharges: [] };
}
