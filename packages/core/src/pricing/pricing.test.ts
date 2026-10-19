import { describe, expect, it } from 'vitest';
import { allocate, money } from '../money';
import {
  PricingError,
  calcularPrecios,
  parsePercentHundredths,
  type PricingCountrySettings,
  type PricingDiscountCode,
  type PricingInput,
  type PricingItem,
  type PricingPaymentMethodSetting,
} from './index';

// ---------------------------------------------------------------------------
// Datos de prueba. Los valores configurables entran como parámetros (regla 3):
// estos son los valores por defecto del seed de Colombia (§11.2, D-012).
// ---------------------------------------------------------------------------

const AHORA = new Date('2026-10-19T15:00:00Z');
const CAT_X = '00000000-0000-4000-8000-0000000000c1';
const CAT_Y = '00000000-0000-4000-8000-0000000000c2';

const CO: PricingCountrySettings = {
  country_code: 'CO',
  currency_code: 'COP',
  cod_enabled: true,
  cod_deposit_amount: 10_000n,
  cod_min_collect_amount: 20_000n,
  financing_surcharge_pct: { addi: 10, sistecredito: 10 },
};

const EC: PricingCountrySettings = {
  country_code: 'EC',
  currency_code: 'USD',
  cod_enabled: false,
  cod_deposit_amount: 0n,
  cod_min_collect_amount: 0n,
  financing_surcharge_pct: {},
};

const METODOS_CO: PricingPaymentMethodSetting[] = [
  { method: 'wompi', is_enabled: true, sort_order: 1 },
  { method: 'addi', is_enabled: true, sort_order: 2 },
  { method: 'sistecredito', is_enabled: true, sort_order: 3 },
  { method: 'cod', is_enabled: true, sort_order: 4 },
];

let seq = 0;
function item(unit_price: bigint, extra: Partial<PricingItem> = {}): PricingItem {
  seq += 1;
  const n = String(seq).padStart(12, '0');
  return {
    variant_id: `00000000-0000-4000-8000-${n}`,
    product_id: `00000000-0000-4000-9000-${n}`,
    quantity: 1,
    unit_price,
    compare_at: null,
    category_ids: [],
    ...extra,
  };
}

function codigo(extra: Partial<PricingDiscountCode>): PricingDiscountCode {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    code: 'IZAO10',
    country_code: 'CO',
    type: 'percent',
    value: 10n,
    max_discount_amount: null,
    min_subtotal: 0n,
    starts_at: null,
    ends_at: null,
    is_active: true,
    applies_to: 'all',
    target_ids: [],
    exclude_ids: [],
    applies_to_sale_items: true,
    usage_limit_total: null,
    usage_count: 0,
    usage_limit_per_customer: null,
    customer_usage_count: 0,
    ...extra,
  };
}

function calc(input: Partial<PricingInput> & Pick<PricingInput, 'items'>) {
  return calcularPrecios({
    countrySettings: CO,
    paymentMethod: 'wompi',
    paymentMethodSettings: METODOS_CO,
    discountCode: null,
    now: AHORA,
    ...input,
  });
}

function metodo(r: ReturnType<typeof calcularPrecios>, m: string) {
  return r.available_methods.find((x) => x.method === m);
}

// ---------------------------------------------------------------------------
// §11.3 — los 10 casos obligatorios, literales
// ---------------------------------------------------------------------------

describe('§11.3 casos obligatorios', () => {
  it('caso 1: 1 × 90.000 contra entrega sin código → total 90.000, abono 10.000, recauda 80.000', () => {
    const r = calc({ items: [item(90_000n)], paymentMethod: 'cod' });
    expect(r.subtotal).toBe(90_000n);
    expect(r.discount).toBe(0n);
    expect(r.total_customer).toBe(90_000n);
    expect(r.cod_deposit).toBe(10_000n);
    expect(r.cod_collect).toBe(80_000n);
    expect(r.carrier_total).toBe(80_000n);
    expect(r.payment_method_available).toBe(true);
  });

  it('caso 2: 1 × 90.000 contra entrega con 10 % → descuento 9.000, total 81.000, abono 10.000, recauda 71.000', () => {
    const r = calc({ items: [item(90_000n)], paymentMethod: 'cod', discountCode: codigo({}) });
    expect(r.discount).toBe(9_000n);
    expect(r.total_customer).toBe(81_000n);
    expect(r.cod_deposit).toBe(10_000n);
    expect(r.cod_collect).toBe(71_000n);
    expect(r.carrier_total).toBe(71_000n);
    expect(r.discount_code?.status).toBe('applied');
  });

  it('caso 3: 1 × 90.000 Wompi con fijo 15.000 → total pagado 75.000, MasterShop prepago 75.000', () => {
    const r = calc({
      items: [item(90_000n)],
      paymentMethod: 'wompi',
      discountCode: codigo({ type: 'fixed', value: 15_000n }),
    });
    expect(r.discount).toBe(15_000n);
    expect(r.total_customer).toBe(75_000n);
    expect(r.carrier_total).toBe(75_000n);
    expect(r.cod_deposit).toBe(0n);
    expect(r.cod_collect).toBe(0n);
  });

  it('caso 4: 1 × 90.000 Addi con 10 % intentado → código retirado, recargo 9.000, total 99.000', () => {
    const r = calc({ items: [item(90_000n)], paymentMethod: 'addi', discountCode: codigo({}) });
    expect(r.discount).toBe(0n);
    expect(r.discount_code?.status).toBe('withdrawn');
    expect(r.messages.map((m) => m.code)).toContain('DISCOUNT_NOT_ALLOWED_WITH_FINANCING');
    expect(r.surcharge).toBe(9_000n);
    expect(r.total_customer).toBe(99_000n);
    expect(r.carrier_total).toBe(90_000n);
  });

  it('caso 5: 90.000 + 120.000 Sistecrédito → subtotal 210.000, recargo 21.000, total 231.000', () => {
    const r = calc({ items: [item(90_000n), item(120_000n)], paymentMethod: 'sistecredito' });
    expect(r.subtotal).toBe(210_000n);
    expect(r.surcharge).toBe(21_000n);
    expect(r.total_customer).toBe(231_000n);
    expect(r.carrier_total).toBe(210_000n);
  });

  it('caso 6: 1 × 25.000 contra entrega con fijo 10.000 → total 15.000, recaudo 5.000 < 20.000, no disponible', () => {
    const r = calc({
      items: [item(25_000n)],
      paymentMethod: 'cod',
      discountCode: codigo({ type: 'fixed', value: 10_000n }),
    });
    expect(r.total_customer).toBe(15_000n);
    expect(r.cod_collect).toBe(5_000n);
    expect(r.payment_method_available).toBe(false);
    expect(metodo(r, 'cod')).toEqual({ method: 'cod', available: false, reason: 'COD_BELOW_MINIMUM' });
    expect(r.messages.map((m) => m.code)).toContain('COD_BELOW_MINIMUM');
    expect(metodo(r, 'wompi')?.available).toBe(true);
  });

  it('caso 7: 1 × 300.000 Wompi con 20 % tope 40.000 → descuento 40.000, total 260.000', () => {
    const r = calc({
      items: [item(300_000n)],
      discountCode: codigo({ value: 20n, max_discount_amount: 40_000n }),
    });
    expect(r.discount).toBe(40_000n);
    expect(r.total_customer).toBe(260_000n);
  });

  it('caso 8: A 100.000 (cat. X) + B 50.000 Wompi con 10 % solo cat. X → descuento 10.000, total 140.000', () => {
    const a = item(100_000n, { category_ids: [CAT_X] });
    const b = item(50_000n, { category_ids: [CAT_Y] });
    const r = calc({
      items: [a, b],
      discountCode: codigo({ applies_to: 'categories', target_ids: [CAT_X] }),
    });
    expect(r.discount).toBe(10_000n);
    expect(r.total_customer).toBe(140_000n);
    expect(r.lines.map((l) => l.line_discount)).toEqual([10_000n, 0n]);
    expect(r.lines.map((l) => l.eligible)).toEqual([true, false]);
  });

  it('caso 9: 2 × USD 49,90 en Ecuador con 10 % → subtotal 99,80, descuento 9,98, total 89,82', () => {
    const r = calc({
      countrySettings: EC,
      paymentMethodSettings: [],
      paymentMethod: null,
      items: [item(4_990n, { quantity: 2 })],
      discountCode: codigo({ country_code: 'EC' }),
    });
    expect(r.currency).toBe('USD');
    expect(r.subtotal).toBe(9_980n);
    expect(r.discount).toBe(998n);
    expect(r.total_customer).toBe(8_982n);
  });

  it('caso 10: 90.000 + 60.000 contra entrega con 10 % → descuento 15.000 (9.000 + 6.000), total 135.000, recauda 125.000, ítems a MasterShop 75.000 y 50.000', () => {
    const r = calc({
      items: [item(90_000n), item(60_000n)],
      paymentMethod: 'cod',
      discountCode: codigo({}),
    });
    expect(r.discount).toBe(15_000n);
    expect(r.lines.map((l) => l.line_discount)).toEqual([9_000n, 6_000n]);
    expect(r.total_customer).toBe(135_000n);
    expect(r.cod_deposit).toBe(10_000n);
    expect(r.cod_collect).toBe(125_000n);
    expect(r.carrier_total).toBe(125_000n);
    // §14.4 opción B: reducción (descuento + abono) = 25.000 prorrateada por línea.
    const reduccion = r.subtotal - r.carrier_total;
    const partes = allocate(
      money(reduccion, 'COP'),
      r.lines.map((l) => l.line_subtotal),
    );
    expect(r.lines.map((l, i) => l.line_subtotal - partes[i]!.amount)).toEqual([75_000n, 50_000n]);
  });
});

// ---------------------------------------------------------------------------
// Reglas de §11.2 y §17.1
// ---------------------------------------------------------------------------

describe('pricing: subtotal y cantidades', () => {
  it('carrito vacío: todo en cero, ningún método disponible', () => {
    const r = calc({ items: [] });
    expect(r.subtotal).toBe(0n);
    expect(r.total_customer).toBe(0n);
    expect(r.messages.map((m) => m.code)).toContain('CART_EMPTY');
    expect(r.available_methods.every((m) => !m.available && m.reason === 'CART_EMPTY')).toBe(true);
    expect(r.payment_method_available).toBe(false);
  });

  it('carrito vacío con código: el código no aplica', () => {
    const r = calc({ items: [], discountCode: codigo({}) });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_NOT_APPLICABLE' });
  });

  it('cantidades grandes sin pérdida', () => {
    const r = calc({ items: [item(999_999_999n, { quantity: 1_000_000 })], discountCode: codigo({}) });
    expect(r.subtotal).toBe(999_999_999_000_000n);
    expect(r.discount).toBe(99_999_999_900_000n);
    expect(r.total_customer).toBe(899_999_999_100_000n);
  });

  it('rechaza cantidades no enteras, cero o negativas y precios negativos', () => {
    expect(() => calc({ items: [item(1_000n, { quantity: 0 })] })).toThrow(PricingError);
    expect(() => calc({ items: [item(1_000n, { quantity: 1.5 })] })).toThrow(PricingError);
    expect(() => calc({ items: [item(1_000n, { quantity: -1 })] })).toThrow(PricingError);
    expect(() => calc({ items: [item(-1n)] })).toThrow(PricingError);
    // @ts-expect-error precio Number no permitido
    expect(() => calc({ items: [item(1000)] })).toThrow(PricingError);
  });

  it('rechaza moneda del país inconsistente', () => {
    expect(() =>
      calc({ countrySettings: { ...CO, currency_code: 'USD' }, items: [item(1n)] }),
    ).toThrow(PricingError);
  });

  it('el resultado es inmutable', () => {
    const r = calc({ items: [item(90_000n)] });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.lines)).toBe(true);
    expect(Object.isFrozen(r.lines[0])).toBe(true);
  });
});

describe('pricing: códigos de descuento', () => {
  it('fijo mayor que la base: el descuento se limita a la base', () => {
    const r = calc({ items: [item(5_000n)], discountCode: codigo({ type: 'fixed', value: 10_000n }) });
    expect(r.discount).toBe(5_000n);
    expect(r.total_customer).toBe(0n);
  });

  it('defensa: total 0 con pago en línea (Wompi) queda marcado con error estable y no disponible', () => {
    const r = calc({
      items: [item(15_000n)],
      paymentMethod: 'wompi',
      discountCode: codigo({ type: 'fixed', value: 15_000n }),
    });
    expect(r.total_customer).toBe(0n);
    expect(r.payment_method_available).toBe(false);
    expect(r.messages).toContainEqual({ code: 'TOTAL_NOT_POSITIVE', level: 'error' });
    expect(metodo(r, 'wompi')).toEqual({
      method: 'wompi',
      available: false,
      reason: 'TOTAL_NOT_POSITIVE',
    });
  });

  it('defensa: con total positivo no aparece TOTAL_NOT_POSITIVE', () => {
    const r = calc({ items: [item(15_001n)], discountCode: codigo({ type: 'fixed', value: 15_000n }) });
    expect(r.total_customer).toBe(1n);
    expect(r.payment_method_available).toBe(true);
    expect(r.messages.map((m) => m.code)).not.toContain('TOTAL_NOT_POSITIVE');
  });

  it('defensa: total 0 en pedido manual o sin método no emite TOTAL_NOT_POSITIVE (no hay pago en línea)', () => {
    for (const paymentMethod of ['manual', null] as const) {
      const r = calc({
        items: [item(15_000n)],
        paymentMethod,
        discountCode: codigo({ type: 'fixed', value: 15_000n }),
      });
      expect(r.messages.map((m) => m.code)).not.toContain('TOTAL_NOT_POSITIVE');
    }
  });

  it('fijo mayor que la base elegible (por categoría) se limita a esa base', () => {
    const r = calc({
      items: [item(5_000n, { category_ids: [CAT_X] }), item(50_000n)],
      discountCode: codigo({
        type: 'fixed',
        value: 10_000n,
        applies_to: 'categories',
        target_ids: [CAT_X],
      }),
    });
    expect(r.discount).toBe(5_000n);
    expect(r.lines.map((l) => l.line_discount)).toEqual([5_000n, 0n]);
  });

  it('porcentaje con tope mayor que el cálculo no limita', () => {
    const r = calc({
      items: [item(100_000n)],
      discountCode: codigo({ value: 20n, max_discount_amount: 50_000n }),
    });
    expect(r.discount).toBe(20_000n);
  });

  it('porcentaje redondea medio hacia arriba: 15 % de 33.333 = 4.999,95 → 5.000', () => {
    const r = calc({ items: [item(33_333n)], discountCode: codigo({ value: 15n }) });
    expect(r.discount).toBe(5_000n);
  });

  it('applies_to = products', () => {
    const a = item(80_000n);
    const b = item(20_000n);
    const r = calc({
      items: [a, b],
      discountCode: codigo({ applies_to: 'products', target_ids: [b.product_id] }),
    });
    expect(r.discount).toBe(2_000n);
    expect(r.lines.map((l) => l.line_discount)).toEqual([0n, 2_000n]);
  });

  it('exclusiones por producto y por categoría', () => {
    const a = item(80_000n);
    const b = item(20_000n, { category_ids: [CAT_Y] });
    const c = item(50_000n);
    const r = calc({
      items: [a, b, c],
      discountCode: codigo({ exclude_ids: [a.product_id, CAT_Y] }),
    });
    expect(r.discount).toBe(5_000n);
    expect(r.lines.map((l) => l.eligible)).toEqual([false, false, true]);
  });

  it('applies_to_sale_items = false excluye productos rebajados', () => {
    const rebajado = item(80_000n, { compare_at: 100_000n });
    const normal = item(20_000n, { compare_at: 20_000n });
    const r = calc({
      items: [rebajado, normal],
      discountCode: codigo({ applies_to_sale_items: false }),
    });
    expect(r.discount).toBe(2_000n);
    expect(r.lines.map((l) => l.is_sale_item)).toEqual([true, false]);
  });

  it('applies_to_sale_items = false y todo rebajado → no aplica', () => {
    const r = calc({
      items: [item(80_000n, { compare_at: 100_000n })],
      discountCode: codigo({ applies_to_sale_items: false }),
    });
    expect(r.discount).toBe(0n);
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_NOT_APPLICABLE' });
  });

  it('código inactivo', () => {
    const r = calc({ items: [item(90_000n)], discountCode: codigo({ is_active: false }) });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_INACTIVE' });
    expect(r.discount).toBe(0n);
  });

  it('código vencido (ends_at ya pasó o es exactamente ahora)', () => {
    for (const ends_at of [new Date('2026-10-01T00:00:00Z'), AHORA]) {
      const r = calc({ items: [item(90_000n)], discountCode: codigo({ ends_at }) });
      expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_EXPIRED' });
    }
  });

  it('código que aún no empieza', () => {
    const r = calc({
      items: [item(90_000n)],
      discountCode: codigo({ starts_at: new Date('2026-11-01T00:00:00Z') }),
    });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_NOT_STARTED' });
  });

  it('código vigente justo en starts_at', () => {
    const r = calc({ items: [item(90_000n)], discountCode: codigo({ starts_at: AHORA }) });
    expect(r.discount_code?.status).toBe('applied');
  });

  it('código de otro país', () => {
    const r = calc({ items: [item(90_000n)], discountCode: codigo({ country_code: 'EC' }) });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_WRONG_COUNTRY' });
  });

  it('compra mínima no cumplida informa el faltante', () => {
    const r = calc({ items: [item(90_000n)], discountCode: codigo({ min_subtotal: 100_000n }) });
    expect(r.discount_code).toMatchObject({
      status: 'rejected',
      reason: 'CODE_MIN_SUBTOTAL',
      missing_amount: 10_000n,
    });
    const m = r.messages.find((x) => x.code === 'CODE_MIN_SUBTOTAL');
    expect(m?.missing_amount).toBe(10_000n);
  });

  it('compra mínima exacta se cumple', () => {
    const r = calc({ items: [item(90_000n)], discountCode: codigo({ min_subtotal: 90_000n }) });
    expect(r.discount_code?.status).toBe('applied');
  });

  it('límite de usos total alcanzado', () => {
    const r = calc({
      items: [item(90_000n)],
      discountCode: codigo({ usage_limit_total: 5, usage_count: 5 }),
    });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_LIMIT_REACHED' });
  });

  it('límite de usos por cliente alcanzado', () => {
    const r = calc({
      items: [item(90_000n)],
      discountCode: codigo({ usage_limit_per_customer: 1, customer_usage_count: 1 }),
    });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_LIMIT_REACHED' });
  });

  it('límite por cliente sin cliente identificado: aplica en vista previa pero queda pendiente', () => {
    const r = calc({
      items: [item(90_000n)],
      discountCode: codigo({ usage_limit_per_customer: 1, customer_usage_count: null }),
    });
    expect(r.discount_code).toMatchObject({ status: 'applied', customer_check_pending: true });
  });

  it('porcentaje fuera de 1–100 (D-016) es inválido', () => {
    for (const value of [0n, 101n, -5n]) {
      const r = calc({ items: [item(90_000n)], discountCode: codigo({ value }) });
      expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_INVALID' });
    }
  });

  it('fijo con valor no positivo es inválido', () => {
    const r = calc({ items: [item(90_000n)], discountCode: codigo({ type: 'fixed', value: 0n }) });
    expect(r.discount_code).toMatchObject({ status: 'rejected', reason: 'CODE_INVALID' });
  });

  it('el código se retira con Sistecrédito igual que con Addi', () => {
    const r = calc({
      items: [item(90_000n)],
      paymentMethod: 'sistecredito',
      discountCode: codigo({}),
    });
    expect(r.discount_code?.status).toBe('withdrawn');
    expect(r.discount).toBe(0n);
  });

  it('cambio Wompi → Addi → contra entrega en el mismo carrito: el código vuelve', () => {
    const items = [item(90_000n)];
    const discountCode = codigo({});
    const wompi = calc({ items, discountCode, paymentMethod: 'wompi' });
    const addi = calc({ items, discountCode, paymentMethod: 'addi' });
    const cod = calc({ items, discountCode, paymentMethod: 'cod' });
    expect([wompi.discount, addi.discount, cod.discount]).toEqual([9_000n, 0n, 9_000n]);
    expect([wompi.total_customer, addi.total_customer, cod.total_customer]).toEqual([
      81_000n,
      99_000n,
      81_000n,
    ]);
    expect(cod.cod_collect).toBe(71_000n);
  });
});

describe('pricing: recargo de financiación', () => {
  it('porcentaje distinto por proveedor', () => {
    const settings = { ...CO, financing_surcharge_pct: { addi: 10, sistecredito: 12.5 } };
    const addi = calc({ countrySettings: settings, items: [item(100_000n)], paymentMethod: 'addi' });
    const siste = calc({
      countrySettings: settings,
      items: [item(100_000n)],
      paymentMethod: 'sistecredito',
    });
    expect(addi.surcharge).toBe(10_000n);
    expect(siste.surcharge).toBe(12_500n);
    expect(siste.surcharge_pct_hundredths).toBe(1_250n);
  });

  it('porcentaje como texto decimal desde jsonb', () => {
    const settings = { ...CO, financing_surcharge_pct: { addi: '7.25' } };
    const r = calc({ countrySettings: settings, items: [item(100_000n)], paymentMethod: 'addi' });
    expect(r.surcharge).toBe(7_250n);
  });

  it('recargo redondea medio hacia arriba', () => {
    expect(calc({ items: [item(33_335n)], paymentMethod: 'addi' }).surcharge).toBe(3_334n);
    expect(calc({ items: [item(33_334n)], paymentMethod: 'addi' }).surcharge).toBe(3_333n);
  });

  it('sin porcentaje configurado el método de financiación no está disponible (nada quemado)', () => {
    const settings = { ...CO, financing_surcharge_pct: { addi: 10 } };
    const r = calc({ countrySettings: settings, items: [item(100_000n)], paymentMethod: 'sistecredito' });
    expect(metodo(r, 'sistecredito')).toEqual({
      method: 'sistecredito',
      available: false,
      reason: 'FINANCING_PCT_MISSING',
    });
    expect(r.payment_method_available).toBe(false);
    expect(metodo(r, 'addi')?.available).toBe(true);
  });

  it('porcentaje 0 configurado explícitamente no cobra recargo', () => {
    const settings = { ...CO, financing_surcharge_pct: { addi: 0 } };
    const r = calc({ countrySettings: settings, items: [item(100_000n)], paymentMethod: 'addi' });
    expect(r.surcharge).toBe(0n);
    expect(r.payment_method_available).toBe(true);
  });

  it('Wompi y contra entrega no tienen recargo', () => {
    expect(calc({ items: [item(100_000n)], paymentMethod: 'wompi' }).surcharge).toBe(0n);
    expect(calc({ items: [item(100_000n)], paymentMethod: 'cod' }).surcharge).toBe(0n);
  });

  it('parsePercentHundredths acepta enteros y hasta 2 decimales, sin float', () => {
    expect(parsePercentHundredths(10)).toBe(1_000n);
    expect(parsePercentHundredths('10')).toBe(1_000n);
    expect(parsePercentHundredths(12.5)).toBe(1_250n);
    expect(parsePercentHundredths('0.01')).toBe(1n);
    expect(parsePercentHundredths(10.123)).toBeNull();
    expect(parsePercentHundredths(-1)).toBeNull();
    expect(parsePercentHundredths('abc')).toBeNull();
    expect(parsePercentHundredths(Number.NaN)).toBeNull();
    expect(parsePercentHundredths(null)).toBeNull();
    expect(parsePercentHundredths(1e21)).toBeNull();
  });
});

describe('pricing: contra entrega y métodos', () => {
  it('Ecuador sin contra entrega ni pasarelas: ningún método disponible', () => {
    const r = calc({
      countrySettings: EC,
      paymentMethodSettings: [],
      paymentMethod: null,
      items: [item(4_990n)],
    });
    expect(r.available_methods.filter((m) => m.available)).toEqual([]);
    expect(r.messages.map((m) => m.code)).toContain('NO_PAYMENT_METHODS');
  });

  it('Ecuador con cod habilitado en métodos pero apagado en el país → COD_DISABLED', () => {
    const r = calc({
      countrySettings: EC,
      paymentMethodSettings: [{ method: 'cod', is_enabled: true, sort_order: 1 }],
      paymentMethod: 'cod',
      items: [item(4_990n)],
    });
    expect(metodo(r, 'cod')).toEqual({ method: 'cod', available: false, reason: 'COD_DISABLED' });
  });

  it('contra entrega sin abono configurado → COD_NOT_CONFIGURED', () => {
    const r = calc({
      countrySettings: { ...CO, cod_deposit_amount: 0n },
      items: [item(90_000n)],
      paymentMethod: 'cod',
    });
    expect(metodo(r, 'cod')?.reason).toBe('COD_NOT_CONFIGURED');
  });

  it('recaudo exactamente igual al mínimo sí está disponible', () => {
    const r = calc({ items: [item(30_000n)], paymentMethod: 'cod' });
    expect(r.cod_collect).toBe(20_000n);
    expect(r.payment_method_available).toBe(true);
  });

  it('total menor que el abono → no disponible', () => {
    const r = calc({
      countrySettings: { ...CO, cod_min_collect_amount: 0n },
      items: [item(5_000n)],
      paymentMethod: 'cod',
    });
    expect(r.cod_collect).toBe(-5_000n);
    expect(r.payment_method_available).toBe(false);
    expect(metodo(r, 'cod')?.reason).toBe('COD_BELOW_MINIMUM');
  });

  it('la disponibilidad de contra entrega usa el total con el descuento de contra entrega aunque se mire desde Addi', () => {
    // Con Addi el código se retira, pero la disponibilidad de cod se evalúa con el código.
    const r = calc({
      items: [item(25_000n)],
      paymentMethod: 'addi',
      discountCode: codigo({ type: 'fixed', value: 10_000n }),
    });
    expect(metodo(r, 'cod')?.reason).toBe('COD_BELOW_MINIMUM');
  });

  it('método deshabilitado o ausente en el panel → METHOD_DISABLED', () => {
    const r = calc({
      items: [item(90_000n)],
      paymentMethod: 'addi',
      paymentMethodSettings: [
        { method: 'wompi', is_enabled: true, sort_order: 1 },
        { method: 'addi', is_enabled: false, sort_order: 2 },
      ],
    });
    expect(metodo(r, 'addi')).toEqual({ method: 'addi', available: false, reason: 'METHOD_DISABLED' });
    expect(metodo(r, 'cod')).toBeUndefined();
    expect(r.payment_method_available).toBe(false);
    expect(r.messages.map((m) => m.code)).toContain('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('métodos en el orden del panel', () => {
    const r = calc({
      items: [item(90_000n)],
      paymentMethodSettings: [
        { method: 'cod', is_enabled: true, sort_order: 1 },
        { method: 'wompi', is_enabled: true, sort_order: 5 },
        { method: 'addi', is_enabled: true, sort_order: 3 },
      ],
    });
    expect(r.available_methods.map((m) => m.method)).toEqual(['cod', 'addi', 'wompi']);
  });

  it('sin método elegido: sin recargo ni abono, descuento aplicado', () => {
    const r = calc({ items: [item(90_000n)], paymentMethod: null, discountCode: codigo({}) });
    expect(r.total_customer).toBe(81_000n);
    expect(r.cod_deposit).toBe(0n);
    expect(r.payment_method_available).toBe(false);
  });

  it('pedido manual (Ecuador por WhatsApp) se calcula como prepago sin recargo', () => {
    const r = calc({
      countrySettings: EC,
      paymentMethodSettings: [],
      paymentMethod: 'manual',
      items: [item(4_990n, { quantity: 2 })],
    });
    expect(r.total_customer).toBe(9_980n);
    expect(r.carrier_total).toBe(9_980n);
    expect(r.payment_method_available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Propiedades sobre carritos generados (PRNG determinista)
// ---------------------------------------------------------------------------

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s;
  };
}

describe('pricing: propiedades', () => {
  const rnd = prng(20261019);
  const metodos = ['wompi', 'addi', 'sistecredito', 'cod'] as const;

  for (let caso = 0; caso < 300; caso += 1) {
    const n = (rnd() % 5) + 1;
    const items = Array.from({ length: n }, () =>
      item(BigInt((rnd() % 400_000) + 1), {
        quantity: (rnd() % 4) + 1,
        compare_at: rnd() % 3 === 0 ? 500_000n : null,
        category_ids: rnd() % 2 === 0 ? [CAT_X] : [CAT_Y],
      }),
    );
    const tipo = rnd() % 2 === 0 ? 'percent' : 'fixed';
    const discountCode = codigo({
      type: tipo,
      value: tipo === 'percent' ? BigInt((rnd() % 100) + 1) : BigInt((rnd() % 900_000) + 1),
      max_discount_amount: rnd() % 3 === 0 ? BigInt((rnd() % 50_000) + 1) : null,
      applies_to: rnd() % 2 === 0 ? 'all' : 'categories',
      target_ids: [CAT_X],
      applies_to_sale_items: rnd() % 2 === 0,
    });
    const paymentMethod = metodos[rnd() % 4]!;

    it(`carrito generado #${caso} (${paymentMethod})`, () => {
      const r = calc({ items, discountCode, paymentMethod });
      const sumaLineas = r.lines.reduce((a, l) => a + l.line_discount, 0n);
      expect(sumaLineas).toBe(r.discount);
      expect(r.total_customer >= 0n).toBe(true);
      expect(r.total_customer).toBe(r.subtotal - r.discount + r.surcharge);
      for (const l of r.lines) {
        expect(l.line_discount >= 0n).toBe(true);
        expect(l.line_discount <= l.line_subtotal).toBe(true);
        if (!l.eligible) expect(l.line_discount).toBe(0n);
      }
      if (paymentMethod === 'cod') {
        expect(r.cod_deposit + r.cod_collect).toBe(r.total_customer);
      } else {
        expect(r.cod_deposit).toBe(0n);
        expect(r.cod_collect).toBe(0n);
      }
      if (paymentMethod === 'addi' || paymentMethod === 'sistecredito') {
        expect(r.discount).toBe(0n);
        expect(r.surcharge).toBe((r.subtotal * 10n * 2n + 100n) / 200n);
      } else {
        expect(r.surcharge).toBe(0n);
      }
    });
  }
});
