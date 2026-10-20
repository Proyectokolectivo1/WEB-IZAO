/** Datos de prueba del checkout (COP salvo Ecuador en USD con centavos). */
import type { PricingDiscountCode } from '@izao/core/pricing';
import type { VarianteCheckout } from '../fuente';
import { FuenteMemoria } from './fuente-memoria';

export const V1 = '11111111-1111-4111-8111-111111111111';
export const V2 = '22222222-2222-4222-8222-222222222222';
export const V3 = '33333333-3333-4333-8333-333333333333';
export const V4 = '44444444-4444-4444-8444-444444444444';
export const V_NO_EXISTE = '99999999-9999-4999-8999-999999999999';
export const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const CAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const REGION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const CIUDAD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const REGION_EC = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd0';
export const CIUDAD_EC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0';
export const AHORA = new Date('2026-10-20T15:00:00Z');

function variante(p: Partial<VarianteCheckout> & Pick<VarianteCheckout, 'variant_id'>): VarianteCheckout {
  return {
    product_id: P1,
    sku: `SKU-${p.variant_id.slice(0, 4)}`,
    nombre: 'Bruma Silvestre',
    etiqueta: '100 ml',
    category_ids: [CAT],
    vendible: true,
    precio: 0n,
    tachado: null,
    costo: 80_000n,
    disponible: 0,
    peso_kg: '0.500',
    mastershop_product_id: null,
    mastershop_variant_id: null,
    ...p,
  };
}

function codigo(p: Partial<PricingDiscountCode> & Pick<PricingDiscountCode, 'id' | 'code'>): PricingDiscountCode {
  return {
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
    customer_usage_count: null,
    ...p,
  };
}

export const ID_CODIGO = (n: number) => `c0d00000-0000-4000-8000-00000000000${n}`;

export function fuenteDePrueba(): FuenteMemoria {
  const f = new FuenteMemoria();
  f.config.set('CO', {
    ajustes: {
      country_code: 'CO',
      currency_code: 'COP',
      cod_enabled: true,
      cod_deposit_amount: 20_000n,
      cod_min_collect_amount: 50_000n,
      financing_surcharge_pct: { addi: 10, sistecredito: '12.5' },
    },
    metodos: [
      { method: 'wompi', is_enabled: true, sort_order: 1 },
      { method: 'addi', is_enabled: true, sort_order: 2 },
      { method: 'sistecredito', is_enabled: true, sort_order: 3 },
      { method: 'cod', is_enabled: true, sort_order: 4 },
    ],
  });
  f.config.set('EC', {
    ajustes: {
      country_code: 'EC',
      currency_code: 'USD',
      cod_enabled: false,
      cod_deposit_amount: 0n,
      cod_min_collect_amount: 0n,
      financing_surcharge_pct: {},
    },
    metodos: [{ method: 'wompi', is_enabled: false, sort_order: 1 }],
  });
  f.vars.set(V1, { pais: 'CO', ...variante({ variant_id: V1, precio: 200_000n, disponible: 5 }) });
  f.vars.set(V2, {
    pais: 'CO',
    ...variante({ variant_id: V2, product_id: P2, nombre: 'Ámbar Nocturno', etiqueta: null, precio: 100_000n, tachado: 150_000n, disponible: 1 }),
  });
  f.vars.set(V3, { pais: 'CO', ...variante({ variant_id: V3, vendible: false, precio: 90_000n, disponible: 4 }) });
  f.vars.set(V4, { pais: 'EC', ...variante({ variant_id: V4, precio: 4_999n, costo: 2_000n, disponible: 3 }) });
  f.codigos.push(
    codigo({ id: ID_CODIGO(1), code: 'DESC10' }),
    codigo({ id: ID_CODIGO(2), code: 'FIJO50', type: 'fixed', value: 50_000n }),
    codigo({ id: ID_CODIGO(3), code: 'OTROPAIS', country_code: 'EC' }),
    codigo({ id: ID_CODIGO(4), code: 'INACTIVO', is_active: false }),
    codigo({ id: ID_CODIGO(5), code: 'VENCIDO', ends_at: new Date('2026-10-01T00:00:00Z') }),
    codigo({ id: ID_CODIGO(6), code: 'MIN500', min_subtotal: 500_000n }),
    codigo({ id: ID_CODIGO(7), code: 'UNOXCLIENTE', usage_limit_per_customer: 1 }),
    codigo({ id: ID_CODIGO(8), code: 'SINREBAJA', applies_to_sale_items: false }),
  );
  f.ubicaciones.push(
    { pais: 'CO', region_id: REGION, region_nombre: 'Antioquia', city_id: CIUDAD, city_nombre: 'Medellín' },
    { pais: 'EC', region_id: REGION_EC, region_nombre: 'Pichincha', city_id: CIUDAD_EC, city_nombre: 'Quito' },
  );
  return f;
}
