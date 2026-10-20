import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { fijarClienteDbParaPruebas } from '@/lib/db/cliente';
import {
  filaCodigo,
  filaVariante,
  fuenteSupabase,
  mapearCodigo,
  mapearVariante,
  solicitudDePedido,
} from './fuente-supabase';

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

  it('crearPedido envía la huella en la RPC (ya no la descarta el envoltorio)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, estado: 'rechazado', motivo: 'sin_items' }, error: null });
    fijarClienteDbParaPruebas({ rpc } as never);
    await fuenteSupabase.crearPedido({ ...ORDEN, checkout_request_hash: 'b'.repeat(64) }, [ITEM]);
    expect(rpc.mock.calls[0]?.[1].p.order.checkout_request_hash).toBe('b'.repeat(64));
  });

  it('crearPedido: política desactualizada trae la versión vigente de la base', async () => {
    const rpc = async () => ({
      data: { ok: false, estado: 'rechazado', motivo: 'politica_datos_desactualizada', version_vigente: '4' },
      error: null,
    });
    fijarClienteDbParaPruebas({ rpc } as never);
    expect(await fuenteSupabase.crearPedido(ORDEN, [ITEM])).toEqual({
      ok: false,
      motivo: 'politica_datos_desactualizada',
      version_vigente: '4',
    });
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

/** Constructor de consultas falso: registra los filtros y resuelve con `resultado`. */
function consultaFalsa(resultado: { data: unknown; error: null }) {
  const filtros: [string, ...unknown[]][] = [];
  const tablas: string[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'overlaps']) {
    b[m] = (...a: unknown[]) => {
      filtros.push([m, ...a]);
      return b;
    };
  }
  b.maybeSingle = async () => resultado;
  b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko);
  const cliente = {
    from: (t: string) => {
      tablas.push(t);
      return b;
    },
  };
  return { cliente, filtros, tablas };
}

describe('fuente Supabase del checkout: consultas', () => {
  it('código: siempre en mayúsculas y sin espacios contra la columna (única vía índice)', async () => {
    const q = consultaFalsa({ data: null, error: null });
    fijarClienteDbParaPruebas(q.cliente as never);
    expect(await fuenteSupabase.codigo(' desc10 ')).toBeNull();
    expect(q.filtros).toContainEqual(['eq', 'code', 'DESC10']);
  });

  it('código con caracteres fuera del patrón: no consulta', async () => {
    const q = consultaFalsa({ data: null, error: null });
    fijarClienteDbParaPruebas(q.cliente as never);
    expect(await fuenteSupabase.codigo('a,b')).toBeNull();
    expect(q.tablas).toEqual([]);
  });

  it('versionPoliticaDatos usa politica_datos_vigente(país) de la base (pages.kind, sin regex)', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: '3', error: null }).mockResolvedValueOnce({ data: null, error: null });
    fijarClienteDbParaPruebas({ rpc } as never);
    expect(await fuenteSupabase.versionPoliticaDatos('EC')).toBe('3');
    expect(rpc).toHaveBeenCalledWith('politica_datos_vigente', { p_pais: 'EC' });
    expect(await fuenteSupabase.versionPoliticaDatos('CO')).toBeNull();
  });

  it('pedidoPorIdempotencia trae la huella persistida (checkout_request_hash)', async () => {
    const H = 'a'.repeat(64);
    const q = consultaFalsa({
      data: {
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
        checkout_request_hash: H,
        discount_code_text: null,
        shipping_region_id: P,
        shipping_city_id: C,
        shipping_district: null,
        shipping_address1: 'Calle 10 # 20-30',
        shipping_address2: null,
        shipping_notes: null,
        order_items: [{ variant_id: V, name_snapshot: 'Bruma', variant_label: null, quantity: 1, unit_price: '200000', line_discount: '0' }],
        order_events: [{ type: 'created' }],
      },
      error: null,
    });
    fijarClienteDbParaPruebas(q.cliente as never);
    const r = await fuenteSupabase.pedidoPorIdempotencia('clave-1');
    expect(r).toMatchObject({ huella: H, completo: true, total_customer: 200000n });
    expect(String(q.filtros.find((f) => f[0] === 'select')?.[1])).toContain('checkout_request_hash');
  });

  it('solicitud persistida del pedido: líneas, método, código copiado y dirección', () => {
    expect(
      solicitudDePedido({
        country_code: 'CO',
        payment_method: 'wompi',
        discount_code_text: 'DESC10',
        shipping_region_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        shipping_city_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        shipping_district: null,
        shipping_address1: 'Calle 10 # 20-30',
        shipping_address2: 'Apto 301',
        shipping_notes: null,
        order_items: [{ variant_id: V, quantity: 2 }],
      }),
    ).toEqual({
      country_code: 'CO',
      payment_method: 'wompi',
      discount_code: 'DESC10',
      items: [{ variant_id: V, quantity: 2 }],
      shipping: {
        region_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        city_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        district: null,
        address1: 'Calle 10 # 20-30',
        address2: 'Apto 301',
        notes: null,
      },
    });
  });
});
