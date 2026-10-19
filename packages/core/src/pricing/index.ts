/**
 * Motor de precios de Izao (§11). Función pura, sin I/O ni fecha implícita.
 *
 * Se usa en el carrito (vista previa), en el checkout y en el servidor al crear el
 * pedido; el servidor es la fuente de verdad (regla 2). Todo valor configurable
 * (porcentajes, abono, recaudo mínimo, métodos activos) entra como parámetro (regla 3).
 * Los textos en español los pone la UI a partir de los códigos estables de `messages`.
 */
import {
  COUNTRY_CURRENCY,
  MoneyError,
  allocate,
  money,
  roundHalfUpDiv,
  type CountryCode,
  type CurrencyCode,
} from '../money';
import { isFinancingMethod, type PaymentMethod } from '../contracts/domain';

// ---------------------------------------------------------------------------
// Entradas (§11.1)
// ---------------------------------------------------------------------------

export interface PricingItem {
  variant_id: string;
  product_id: string;
  /** Entero > 0. */
  quantity: number;
  /** Precio unitario en unidad menor de la moneda del país. */
  unit_price: bigint;
  /** Precio tachado; si es mayor que `unit_price`, la línea es un producto rebajado. */
  compare_at: bigint | null;
  category_ids: readonly string[];
}

/** Subconjunto de `country_settings` que usa el motor. */
export interface PricingCountrySettings {
  country_code: CountryCode;
  currency_code: CurrencyCode;
  cod_enabled: boolean;
  cod_deposit_amount: bigint;
  cod_min_collect_amount: bigint;
  /** `{"addi":10,"sistecredito":10}` tal como llega del jsonb (número o texto decimal). */
  financing_surcharge_pct: Readonly<Record<string, unknown>>;
}

/** Subconjunto de `payment_method_settings`. */
export interface PricingPaymentMethodSetting {
  method: PaymentMethod;
  is_enabled: boolean;
  sort_order: number;
}

/** Código de descuento ya leído de `discount_codes` (§6.2, D-016). */
export interface PricingDiscountCode {
  id: string;
  code: string;
  country_code: CountryCode;
  type: 'percent' | 'fixed';
  /** `percent`: entero 1–100. `fixed`: monto en unidad menor. */
  value: bigint;
  max_discount_amount: bigint | null;
  min_subtotal: bigint;
  starts_at: Date | null;
  ends_at: Date | null;
  is_active: boolean;
  applies_to: 'all' | 'categories' | 'products';
  target_ids: readonly string[];
  /** Ids de producto o de categoría excluidos. */
  exclude_ids: readonly string[];
  applies_to_sale_items: boolean;
  usage_limit_total: number | null;
  usage_count: number;
  usage_limit_per_customer: number | null;
  /**
   * Usos no liberados del cliente (clave = hash de documento + celular + correo).
   * `null` = cliente aún sin identificar (vista previa del carrito). El servidor debe
   * pasarlo siempre al crear el pedido.
   */
  customer_usage_count: number | null;
}

/** `manual` = Ecuador sin pasarela, "Finalizar por WhatsApp" (§5.4, D-016). */
export type PricingPaymentMethod = PaymentMethod | 'manual';

export interface PricingInput {
  items: readonly PricingItem[];
  countrySettings: PricingCountrySettings;
  paymentMethod: PricingPaymentMethod | null;
  paymentMethodSettings: readonly PricingPaymentMethodSetting[];
  discountCode: PricingDiscountCode | null;
  /** Instante de referencia para la vigencia del código. */
  now: Date;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export type DiscountRejectionCode =
  | 'CODE_INACTIVE'
  | 'CODE_WRONG_COUNTRY'
  | 'CODE_NOT_STARTED'
  | 'CODE_EXPIRED'
  | 'CODE_LIMIT_REACHED'
  | 'CODE_MIN_SUBTOTAL'
  | 'CODE_NOT_APPLICABLE'
  | 'CODE_INVALID';

export type MethodUnavailableCode =
  | 'CART_EMPTY'
  | 'METHOD_DISABLED'
  | 'COD_DISABLED'
  | 'COD_NOT_CONFIGURED'
  | 'COD_BELOW_MINIMUM'
  | 'FINANCING_PCT_MISSING'
  | 'TOTAL_NOT_POSITIVE';

export type PricingMessageCode =
  | 'CART_EMPTY'
  | 'DISCOUNT_NOT_ALLOWED_WITH_FINANCING'
  | DiscountRejectionCode
  | 'COD_BELOW_MINIMUM'
  | 'TOTAL_NOT_POSITIVE'
  | 'NO_PAYMENT_METHODS'
  | 'PAYMENT_METHOD_UNAVAILABLE';

export interface PricingMessage {
  readonly code: PricingMessageCode;
  readonly level: 'info' | 'warning' | 'error';
  /** Para `CODE_MIN_SUBTOTAL`: cuánto falta para usar el código. */
  readonly missing_amount?: bigint;
  /** Para `PAYMENT_METHOD_UNAVAILABLE`: motivo. */
  readonly reason?: MethodUnavailableCode;
}

export interface PricingLine {
  readonly variant_id: string;
  readonly product_id: string;
  readonly quantity: number;
  readonly unit_price: bigint;
  readonly line_subtotal: bigint;
  readonly line_discount: bigint;
  readonly is_sale_item: boolean;
  /** Si la línea entra en la base del código aplicado. */
  readonly eligible: boolean;
}

export interface DiscountCodeOutcome {
  readonly id: string;
  readonly code: string;
  /** `withdrawn`: retirado por Addi/Sistecrédito; vuelve si se cambia de método. */
  readonly status: 'applied' | 'withdrawn' | 'rejected';
  readonly reason: DiscountRejectionCode | null;
  readonly missing_amount: bigint | null;
  /** Límite por cliente sin verificar (cliente no identificado). El servidor no debe crear el pedido así. */
  readonly customer_check_pending: boolean;
}

export interface MethodAvailability {
  readonly method: PaymentMethod;
  readonly available: boolean;
  readonly reason: MethodUnavailableCode | null;
}

export interface PricingResult {
  readonly currency: CurrencyCode;
  readonly payment_method: PricingPaymentMethod | null;
  /** Si el método elegido está disponible para este carrito (false si no hay método). */
  readonly payment_method_available: boolean;
  readonly lines: readonly PricingLine[];
  readonly subtotal: bigint;
  readonly discount: bigint;
  /** Porcentaje del recargo en centésimas (1000n = 10 %). 0 si no hay financiación. */
  readonly surcharge_pct_hundredths: bigint;
  readonly surcharge: bigint;
  /** subtotal − descuento + recargo. Envío siempre 0. */
  readonly total_customer: bigint;
  /** Solo contra entrega; 0 en los demás métodos. */
  readonly cod_deposit: bigint;
  /** total_customer − cod_deposit en contra entrega; 0 en los demás. */
  readonly cod_collect: bigint;
  /** `order_transaction.total` para la transportadora (§14.4). */
  readonly carrier_total: bigint;
  readonly discount_code: DiscountCodeOutcome | null;
  readonly available_methods: readonly MethodAvailability[];
  readonly messages: readonly PricingMessage[];
}

export class PricingError extends Error {
  readonly code: 'INVALID_ITEM' | 'INVALID_SETTINGS';
  constructor(code: 'INVALID_ITEM' | 'INVALID_SETTINGS', message: string) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Convierte un porcentaje del panel (número o texto, hasta 2 decimales) a centésimas
 * `bigint` sin aritmética de punto flotante: `10` → 1000n, `12.5` → 1250n.
 * Devuelve `null` si no es un porcentaje válido (negativo, >2 decimales, no numérico).
 */
export function parsePercentHundredths(value: unknown): bigint | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

function validateInput(input: PricingInput): void {
  const cs = input.countrySettings;
  if (COUNTRY_CURRENCY[cs.country_code] !== cs.currency_code) {
    throw new PricingError(
      'INVALID_SETTINGS',
      `La moneda ${cs.currency_code} no corresponde al país ${cs.country_code}.`,
    );
  }
  for (const [name, v] of [
    ['cod_deposit_amount', cs.cod_deposit_amount],
    ['cod_min_collect_amount', cs.cod_min_collect_amount],
  ] as const) {
    if (typeof v !== 'bigint' || v < 0n) {
      throw new PricingError('INVALID_SETTINGS', `${name} debe ser bigint ≥ 0.`);
    }
  }
  for (const it of input.items) {
    if (!Number.isSafeInteger(it.quantity) || it.quantity < 1) {
      throw new PricingError('INVALID_ITEM', `Cantidad inválida para ${it.variant_id}.`);
    }
    if (typeof it.unit_price !== 'bigint' || it.unit_price < 0n) {
      throw new PricingError('INVALID_ITEM', `Precio inválido para ${it.variant_id}.`);
    }
    if (it.compare_at !== null && typeof it.compare_at !== 'bigint') {
      throw new PricingError('INVALID_ITEM', `Precio tachado inválido para ${it.variant_id}.`);
    }
  }
  const dc = input.discountCode;
  if (dc) {
    for (const v of [dc.value, dc.min_subtotal]) {
      if (typeof v !== 'bigint') throw new PricingError('INVALID_SETTINGS', 'Código con montos no bigint.');
    }
    if (dc.max_discount_amount !== null && typeof dc.max_discount_amount !== 'bigint') {
      throw new PricingError('INVALID_SETTINGS', 'Código con tope no bigint.');
    }
  }
}

interface LineBase {
  item: PricingItem;
  line_subtotal: bigint;
  is_sale_item: boolean;
}

function lineEligible(line: LineBase, dc: PricingDiscountCode): boolean {
  const { item } = line;
  const excluded = new Set(dc.exclude_ids);
  if (excluded.has(item.product_id) || item.category_ids.some((c) => excluded.has(c))) {
    return false;
  }
  if (!dc.applies_to_sale_items && line.is_sale_item) return false;
  if (dc.applies_to === 'all') return true;
  const targets = new Set(dc.target_ids);
  if (dc.applies_to === 'products') return targets.has(item.product_id);
  return item.category_ids.some((c) => targets.has(c));
}

interface DiscountEval {
  outcome: DiscountCodeOutcome;
  discount: bigint;
  eligible: boolean[];
  lineDiscounts: bigint[];
}

function evaluateDiscount(
  dc: PricingDiscountCode,
  lines: readonly LineBase[],
  subtotal: bigint,
  input: PricingInput,
): DiscountEval {
  const noLines = lines.map(() => 0n);
  const noElig = lines.map(() => false);
  const reject = (reason: DiscountRejectionCode, missing: bigint | null = null): DiscountEval => ({
    outcome: {
      id: dc.id,
      code: dc.code,
      status: 'rejected',
      reason,
      missing_amount: missing,
      customer_check_pending: false,
    },
    discount: 0n,
    eligible: noElig,
    lineDiscounts: noLines,
  });

  if (dc.type === 'percent' ? dc.value < 1n || dc.value > 100n : dc.value <= 0n) {
    return reject('CODE_INVALID');
  }
  if (!dc.is_active) return reject('CODE_INACTIVE');
  if (dc.country_code !== input.countrySettings.country_code) return reject('CODE_WRONG_COUNTRY');
  const now = input.now.getTime();
  if (dc.starts_at && now < dc.starts_at.getTime()) return reject('CODE_NOT_STARTED');
  if (dc.ends_at && now >= dc.ends_at.getTime()) return reject('CODE_EXPIRED');
  if (dc.usage_limit_total !== null && dc.usage_count >= dc.usage_limit_total) {
    return reject('CODE_LIMIT_REACHED');
  }
  let customerPending = false;
  if (dc.usage_limit_per_customer !== null) {
    if (dc.customer_usage_count === null) customerPending = true;
    else if (dc.customer_usage_count >= dc.usage_limit_per_customer) {
      return reject('CODE_LIMIT_REACHED');
    }
  }
  if (lines.length > 0 && subtotal < dc.min_subtotal) {
    return reject('CODE_MIN_SUBTOTAL', dc.min_subtotal - subtotal);
  }

  const eligible = lines.map((l) => lineEligible(l, dc));
  const base = lines.reduce((a, l, i) => (eligible[i] ? a + l.line_subtotal : a), 0n);
  if (base === 0n) return reject('CODE_NOT_APPLICABLE');

  let discount: bigint;
  if (dc.type === 'percent') {
    discount = roundHalfUpDiv(base * dc.value, 100n);
    if (dc.max_discount_amount !== null && discount > dc.max_discount_amount) {
      discount = dc.max_discount_amount;
    }
  } else {
    discount = dc.value < base ? dc.value : base;
  }

  const currency = input.countrySettings.currency_code;
  const weights = lines.map((l, i) => (eligible[i] ? l.line_subtotal : 0n));
  const lineDiscounts = allocate(money(discount, currency), weights).map((m) => m.amount);

  return {
    outcome: {
      id: dc.id,
      code: dc.code,
      status: 'applied',
      reason: null,
      missing_amount: null,
      customer_check_pending: customerPending,
    },
    discount,
    eligible,
    lineDiscounts,
  };
}

interface MethodCalc {
  discountEval: DiscountEval | null;
  withdrawn: boolean;
  discount: bigint;
  surchargePct: bigint;
  surcharge: bigint;
  total: bigint;
  codDeposit: bigint;
  codCollect: bigint;
  carrierTotal: bigint;
  unavailable: MethodUnavailableCode | null;
}

function computeFor(
  method: PricingPaymentMethod | null,
  lines: readonly LineBase[],
  subtotal: bigint,
  input: PricingInput,
): MethodCalc {
  const cs = input.countrySettings;
  const financing = method !== null && isFinancingMethod(method);
  const dc = input.discountCode;

  let discountEval: DiscountEval | null = null;
  let discount = 0n;
  if (dc && !financing) {
    discountEval = evaluateDiscount(dc, lines, subtotal, input);
    discount = discountEval.discount;
  }

  let unavailable: MethodUnavailableCode | null = lines.length === 0 ? 'CART_EMPTY' : null;

  let surchargePct = 0n;
  let surcharge = 0n;
  if (financing) {
    const pct = parsePercentHundredths(cs.financing_surcharge_pct[method]);
    if (pct === null) {
      unavailable ??= 'FINANCING_PCT_MISSING';
    } else {
      surchargePct = pct;
      surcharge = roundHalfUpDiv(subtotal * pct, 10_000n);
    }
  }

  const total = subtotal - discount + surcharge;

  // Defensa: un pago en línea nunca se crea por 0 o menos. El dueño indica que un código
  // fijo no alcanza el precio de ningún producto; si ocurriera, el checkout debe negarse.
  if (isOnlineMethod(method) && total <= 0n) unavailable ??= 'TOTAL_NOT_POSITIVE';

  let codDeposit = 0n;
  let codCollect = 0n;
  if (method === 'cod') {
    codDeposit = cs.cod_deposit_amount;
    codCollect = total - codDeposit;
    if (!cs.cod_enabled) unavailable ??= 'COD_DISABLED';
    else if (codDeposit <= 0n) unavailable ??= 'COD_NOT_CONFIGURED';
    else if (codCollect < 0n || codCollect < cs.cod_min_collect_amount) {
      unavailable ??= 'COD_BELOW_MINIMUM';
    }
  }

  // §14.4: cod → recaudo; Wompi/manual → lo pagado; financiación → subtotal de productos.
  const carrierTotal = method === 'cod' ? codCollect : financing ? subtotal : subtotal - discount;

  return {
    discountEval,
    withdrawn: Boolean(dc) && financing,
    discount,
    surchargePct,
    surcharge,
    total,
    codDeposit,
    codCollect,
    carrierTotal,
    unavailable,
  };
}

/** Métodos que cobran en línea el total del pedido. */
function isOnlineMethod(method: PricingPaymentMethod | null): boolean {
  return method === 'wompi' || method === 'addi' || method === 'sistecredito';
}

function freezeAll<T extends object>(list: T[]): readonly Readonly<T>[] {
  return Object.freeze(list.map((x) => Object.freeze(x)));
}

// ---------------------------------------------------------------------------
// Cálculo principal (§11.2)
// ---------------------------------------------------------------------------

export function calcularPrecios(input: PricingInput): PricingResult {
  validateInput(input);
  const cs = input.countrySettings;
  const currency = cs.currency_code;

  // 1. subtotal = Σ unit_price × quantity
  const lines: LineBase[] = input.items.map((item) => ({
    item,
    line_subtotal: item.unit_price * BigInt(item.quantity),
    is_sale_item: item.compare_at !== null && item.compare_at > item.unit_price,
  }));
  const subtotal = lines.reduce((a, l) => a + l.line_subtotal, 0n);

  // 2–5 para el método elegido
  let selected: MethodCalc;
  try {
    selected = computeFor(input.paymentMethod, lines, subtotal, input);
  } catch (e) {
    if (e instanceof MoneyError) throw new PricingError('INVALID_ITEM', e.message);
    throw e;
  }

  // Disponibilidad de cada método del país, en el orden del panel. Cada método se
  // evalúa con su propio total (con Addi el código no aplica; con cod sí).
  const available_methods: MethodAvailability[] = [...input.paymentMethodSettings]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => {
      if (lines.length === 0) return { method: s.method, available: false, reason: 'CART_EMPTY' };
      if (!s.is_enabled) return { method: s.method, available: false, reason: 'METHOD_DISABLED' };
      const reason =
        s.method === input.paymentMethod
          ? selected.unavailable
          : computeFor(s.method, lines, subtotal, input).unavailable;
      return { method: s.method, available: reason === null, reason };
    });

  let payment_method_available = false;
  let selectedReason: MethodUnavailableCode | null = null;
  if (input.paymentMethod === 'manual') {
    payment_method_available = lines.length > 0;
    selectedReason = lines.length > 0 ? null : 'CART_EMPTY';
  } else if (input.paymentMethod !== null) {
    const entry = available_methods.find((m) => m.method === input.paymentMethod);
    selectedReason = entry ? entry.reason : 'METHOD_DISABLED';
    payment_method_available = selectedReason === null;
  }

  // Mensajes con códigos estables
  const messages: PricingMessage[] = [];
  if (lines.length === 0) messages.push({ code: 'CART_EMPTY', level: 'info' });
  if (selected.withdrawn) {
    messages.push({ code: 'DISCOUNT_NOT_ALLOWED_WITH_FINANCING', level: 'warning' });
  }
  const outcomeBase = selected.discountEval?.outcome;
  if (outcomeBase?.status === 'rejected' && outcomeBase.reason) {
    messages.push(
      outcomeBase.reason === 'CODE_MIN_SUBTOTAL' && outcomeBase.missing_amount !== null
        ? { code: 'CODE_MIN_SUBTOTAL', level: 'error', missing_amount: outcomeBase.missing_amount }
        : { code: outcomeBase.reason, level: 'error' },
    );
  }
  if (lines.length > 0 && isOnlineMethod(input.paymentMethod) && selected.total <= 0n) {
    messages.push({ code: 'TOTAL_NOT_POSITIVE', level: 'error' });
  }
  if (available_methods.some((m) => m.method === 'cod' && m.reason === 'COD_BELOW_MINIMUM')) {
    messages.push({ code: 'COD_BELOW_MINIMUM', level: 'info' });
  }
  if (lines.length > 0 && !available_methods.some((m) => m.available)) {
    messages.push({ code: 'NO_PAYMENT_METHODS', level: 'info' });
  }
  if (input.paymentMethod !== null && !payment_method_available && selectedReason !== null) {
    messages.push({ code: 'PAYMENT_METHOD_UNAVAILABLE', level: 'error', reason: selectedReason });
  }

  const dcOutcome: DiscountCodeOutcome | null = input.discountCode
    ? selected.withdrawn
      ? {
          id: input.discountCode.id,
          code: input.discountCode.code,
          status: 'withdrawn',
          reason: null,
          missing_amount: null,
          customer_check_pending: false,
        }
      : selected.discountEval!.outcome
    : null;

  const ev = selected.discountEval;
  const outLines: PricingLine[] = lines.map((l, i) => ({
    variant_id: l.item.variant_id,
    product_id: l.item.product_id,
    quantity: l.item.quantity,
    unit_price: l.item.unit_price,
    line_subtotal: l.line_subtotal,
    line_discount: ev ? ev.lineDiscounts[i]! : 0n,
    is_sale_item: l.is_sale_item,
    eligible: ev ? ev.eligible[i]! : false,
  }));

  return Object.freeze({
    currency,
    payment_method: input.paymentMethod,
    payment_method_available,
    lines: freezeAll(outLines),
    subtotal,
    discount: selected.discount,
    surcharge_pct_hundredths: selected.surchargePct,
    surcharge: selected.surcharge,
    total_customer: selected.total,
    cod_deposit: selected.codDeposit,
    cod_collect: selected.codCollect,
    carrier_total: selected.carrierTotal,
    discount_code: dcOutcome ? Object.freeze(dcOutcome) : null,
    available_methods: freezeAll(available_methods),
    messages: freezeAll(messages),
  });
}
