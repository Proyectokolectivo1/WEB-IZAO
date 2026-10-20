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

  it('insertarPedido: choque con la clave de idempotencia → duplicado', async () => {
    const cadena = {
      insert: () => cadena,
      select: () => cadena,
      single: async () => ({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_checkout_idempotency_key_key"' },
      }),
    };
    fijarClienteDbParaPruebas({ from: () => cadena } as never);
    expect(await fuenteSupabase.insertarPedido({ country_code: 'CO' })).toEqual({ ok: false, motivo: 'duplicado' });
  });

  it('otros errores de la base se lanzan sin datos del cliente', async () => {
    const cadena = {
      insert: () => cadena,
      select: () => cadena,
      single: async () => ({ data: null, error: { code: '23514', message: 'orders_total_check' } }),
    };
    fijarClienteDbParaPruebas({ from: () => cadena } as never);
    await expect(fuenteSupabase.insertarPedido({ country_code: 'CO' })).rejects.toThrow('orders.insert');
  });
});
