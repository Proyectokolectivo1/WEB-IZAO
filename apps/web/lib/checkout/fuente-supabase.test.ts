import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { fijarClienteDbParaPruebas } from '@/lib/db/cliente';
import { filaCodigo, filaVariante, fuenteSupabase, mapearCodigo, mapearVariante } from './fuente-supabase';

const V = '11111111-1111-4111-8111-111111111111';
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OV1 = 'f0000000-0000-4000-8000-000000000001';

const fila = {
  id: V,
  product_id: P,
  sku: 'BRU-100',
  option_value_ids: [OV1],
  weight_kg: 0.5,
  mastershop_product_id: 77,
  mastershop_variant_id: null,
  products: {
    name: 'Bruma Silvestre',
    status: 'active',
    product_categories: [{ category_id: C }],
    product_countries: [
      { country_code: 'CO', is_visible: true },
      { country_code: 'EC', is_visible: false },
    ],
  },
  variant_countries: [
    { country_code: 'CO', is_active: true, price: 200000, compare_at_price: null, cost: '80000', stock: 7, stock_reserved: 2 },
    { country_code: 'EC', is_active: true, price: 4999, compare_at_price: 5999, cost: null, stock: 1, stock_reserved: 3 },
  ],
};

afterEach(() => fijarClienteDbParaPruebas(null));

describe('fuente Supabase del checkout: mapeos', () => {
  it('variante del país con montos bigint, etiqueta y existencias vendibles', () => {
    const v = mapearVariante(filaVariante.parse(fila), 'CO', new Map([[OV1, '100 ml']]));
    expect(v).toMatchObject({
      vendible: true,
      precio: 200_000n,
      tachado: null,
      costo: 80_000n,
      disponible: 5,
      etiqueta: '100 ml',
      category_ids: [C],
      peso_kg: '0.5',
      mastershop_product_id: 77,
    });
  });

  it('no vendible si el producto no es visible en el país; existencias nunca negativas', () => {
    const v = mapearVariante(filaVariante.parse(fila), 'EC', new Map());
    expect(v.vendible).toBe(false);
    expect(v.disponible).toBe(0);
    expect(v.precio).toBe(4_999n);
    expect(v.etiqueta).toBeNull();
  });

  it('sin fila en el país: sin precio y no vendible', () => {
    const f = filaVariante.parse({ ...fila, variant_countries: [] });
    expect(mapearVariante(f, 'CO', new Map())).toMatchObject({ vendible: false, precio: null, disponible: 0 });
  });

  it('código con fechas y montos tipados; límite por cliente sin evaluar', () => {
    const c = mapearCodigo(
      filaCodigo.parse({
        id: P,
        code: 'DESC10',
        country_code: 'CO',
        type: 'percent',
        value: 10,
        max_discount_amount: '50000',
        min_subtotal: 0,
        starts_at: '2026-10-01T00:00:00+00:00',
        ends_at: null,
        is_active: true,
        applies_to: 'all',
        target_ids: [],
        exclude_ids: [],
        applies_to_sale_items: true,
        usage_limit_total: null,
        usage_count: 3,
        usage_limit_per_customer: 1,
      }),
    );
    expect(c.value).toBe(10n);
    expect(c.max_discount_amount).toBe(50_000n);
    expect(c.starts_at?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(c.customer_usage_count).toBeNull();
  });

  it('un monto con decimales o un float en la fila se rechaza', () => {
    expect(filaVariante.safeParse({ ...fila, variant_countries: [{ ...fila.variant_countries[0], price: 1.5 }] }).success).toBe(false);
  });

  const ORDEN = {
    country_code: 'CO',
    currency_code: 'COP',
    contact_first_name: 'Ana',
    contact_last_name: 'Paz',
    contact_phone_e164: '+573001234567',
    payment_method: 'wompi',
    status: 'pendiente_pago',
    subtotal: '200000',
    total_customer: '200000',
    checkout_idempotency_key: 'clave-1',
  };
  const ITEM = {
    product_id: '00000000-0000-4000-8000-000000000011',
    variant_id: '00000000-0000-4000-8000-000000000012',
    sku: 'SKU-1',
    name_snapshot: 'Bruma',
    variant_label: null,
    quantity: 1,
    unit_price: '200000',
    line_discount: '0',
  };

  it('crearPedido llama crear_pedido_checkout y mapea montos de texto a bigint', async () => {
    let args: unknown = null;
    const rpc = async (_f: string, a: unknown) => {
      args = a;
      return {
        data: {
          ok: true,
          estado: 'creado',
          repetido: false,
          order: {
            id: '00000000-0000-4000-8000-000000000001',
            number: 'IZ-CO-000001',
            public_token: 'tok',
            status: 'pendiente_pago',
            country_code: 'CO',
            currency_code: 'COP',
            payment_method: 'wompi',
            subtotal: '200000',
            discount_amount: '0',
            financing_surcharge_amount: '0',
            total_customer: '200000',
            cod_deposit_amount: '0',
            cod_collect_amount: '0',
            lines: [{ variant_id: ITEM.variant_id, name_snapshot: 'Bruma', variant_label: null, quantity: 1, unit_price: '200000', line_discount: '0' }],
          },
        },
        error: null,
      };
    };
    fijarClienteDbParaPruebas({ rpc } as never);
    const r = await fuenteSupabase.crearPedido(ORDEN, [ITEM]);
    expect(r.ok && r.pedido.total_customer).toBe(200000n);
    expect(r.ok && r.pedido.lines[0]!.unit_price).toBe(200000n);
    // `status` no viaja: lo fija la base por método
    expect((args as { p: { order: Record<string, unknown> } }).p.order.status).toBeUndefined();
  });

  it('crearPedido: rechazo de stock con faltantes', async () => {
    const rpc = async () => ({
      data: { ok: false, estado: 'rechazado', motivo: 'sin_stock', faltantes: [{ variant_id: ITEM.variant_id, sku: 'SKU-1', solicitado: 2, disponible: 1, motivo: 'stock_insuficiente' }] },
      error: null,
    });
    fijarClienteDbParaPruebas({ rpc } as never);
    expect(await fuenteSupabase.crearPedido(ORDEN, [ITEM])).toEqual({
      ok: false,
      motivo: 'sin_stock',
      faltantes: [{ variant_id: ITEM.variant_id, solicitado: 2, disponible: 1 }],
    });
  });

  it('error de la base se lanza sin datos del cliente', async () => {
    const rpc = async () => ({ data: null, error: { code: '23514', message: 'orders_total_check' } });
    fijarClienteDbParaPruebas({ rpc } as never);
    await expect(fuenteSupabase.crearPedido(ORDEN, [ITEM])).rejects.toThrow('crear_pedido_checkout');
  });
});
