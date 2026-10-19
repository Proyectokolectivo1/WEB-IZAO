import type { Order, OrderItem } from '@izao/core/contracts';

/** Línea de pedido de prueba con vínculo a MasterShop. */
export function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    order_id: 'order-1',
    product_id: 'prod-1',
    variant_id: 'var-1',
    sku: 'IZ-0001-100',
    name_snapshot: 'Fragancia de prueba 100 ml',
    variant_label: '100 ml',
    quantity: 1,
    unit_price: 90_000n,
    unit_compare_at: null,
    unit_cost: 40_000n,
    line_discount: 0n,
    weight_kg: 0.5,
    mastershop_product_id: 2001,
    mastershop_variant_id: null,
    ...overrides,
  };
}

/**
 * Pedido de prueba de contra entrega en Colombia: 1 × 90.000, abono 10.000, recaudo 80.000
 * (caso 1 de §11.3). Los totales se recalculan a partir de `items` si no se dan.
 */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  const items = overrides.items ?? [makeItem()];
  const subtotal = items.reduce((a, i) => a + i.unit_price * BigInt(i.quantity), 0n);
  const discount = items.reduce((a, i) => a + i.line_discount, 0n);
  const paymentMethod = overrides.payment_method ?? 'cod';
  const surcharge = overrides.financing_surcharge_amount ?? 0n;
  const totalCustomer = subtotal - discount + surcharge;
  const deposit = paymentMethod === 'cod' ? (overrides.cod_deposit_amount ?? 10_000n) : 0n;
  return {
    id: 'order-1',
    number: 'IZ-CO-000123',
    country_code: 'CO',
    currency_code: 'COP',
    customer_id: null,
    status: paymentMethod === 'cod' ? 'abono_pagado' : 'pagado',
    payment_method: paymentMethod,
    contact_first_name: 'Laura',
    contact_last_name: 'Gómez',
    contact_phone_e164: '+573001234567',
    contact_email: 'laura@example.com',
    document_type: 'CC',
    document_number: '1020304050',
    shipping_region_id: 'reg-ant',
    shipping_city_id: 'city-med',
    shipping_region_name: 'ANTIOQUIA',
    shipping_city_name: 'MEDELLÍN',
    shipping_district: 'El Poblado',
    shipping_address1: 'Calle 10 # 43-20',
    shipping_address2: 'Apto 501',
    shipping_zip: null,
    shipping_notes: null,
    subtotal,
    discount_code_id: discount > 0n ? 'code-1' : null,
    discount_amount: discount,
    financing_surcharge_pct: '0.00',
    financing_surcharge_amount: surcharge,
    total_customer: totalCustomer,
    cod_deposit_amount: deposit,
    cod_collect_amount: paymentMethod === 'cod' ? totalCustomer - deposit : 0n,
    discount_code_text: null,
    terms_accepted_at: new Date('2026-10-19T14:50:00Z'),
    data_policy_version: 'v1',
    whatsapp_opt_in: false,
    stock_state: 'confirmed',
    public_token: 'tok',
    stock_reserved_until: null,
    paid_at: new Date('2026-10-19T15:00:00Z'),
    created_at: new Date('2026-10-19T14:50:00Z'),
    ...overrides,
    items,
  };
}
