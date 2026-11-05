import { describe, expect, it } from 'vitest';
import { bannerVigente, enlaceBanner } from './banners';
import { varianteDeSku } from './ficha-util';
import type { VarianteProducto } from './types';

describe('enlaceBanner', () => {
  it('conserva tal cual rutas internas con variante, categorías y https', () => {
    expect(enlaceBanner('/co/perfume/aroma-uno?variante=ABC-100')).toBe('/co/perfume/aroma-uno?variante=ABC-100');
    expect(enlaceBanner(' /ec/categoria/damas ')).toBe('/ec/categoria/damas');
    expect(enlaceBanner('https://wa.me/573000000000')).toBe('https://wa.me/573000000000');
  });
  it('descarta lo que no es seguro o está vacío', () => {
    for (const mal of [null, undefined, '', '   ', '//malo.com', 'javascript:alert(1)', 'http://inseguro.com', 'ftp://x', '/\\malo', 'perfume/x']) {
      expect(enlaceBanner(mal)).toBeNull();
    }
  });
});

describe('bannerVigente', () => {
  const ahora = new Date('2026-11-05T12:00:00Z');
  it('sin fechas siempre', () => expect(bannerVigente({}, ahora)).toBe(true));
  it('antes del inicio y después del fin no', () => {
    expect(bannerVigente({ starts_at: '2026-11-06T00:00:00+00:00' }, ahora)).toBe(false);
    expect(bannerVigente({ ends_at: '2026-11-05T12:00:00Z' }, ahora)).toBe(false);
    expect(bannerVigente({ starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-30T00:00:00Z' }, ahora)).toBe(true);
  });
});

describe('varianteDeSku', () => {
  const base = { compare_at_price: null, stock_disponible: 3, stock_bajo: false, image: null, option_value_ids: [] as string[] };
  const vs: VarianteProducto[] = [
    { ...base, id: 'v1', sku: 'AB-50', is_default: true, price: 100, in_stock: true },
    { ...base, id: 'v2', sku: 'AB-100', is_default: false, price: 180, in_stock: true },
    { ...base, id: 'v3', sku: 'AB-200', is_default: false, price: 300, in_stock: false },
  ];
  it('encuentra por SKU sin distinguir mayúsculas y por id', () => {
    expect(varianteDeSku(vs, 'ab-100')?.id).toBe('v2');
    expect(varianteDeSku(vs, ' AB-50 ')?.id).toBe('v1');
    expect(varianteDeSku(vs, 'v2')?.id).toBe('v2');
  });
  it('ignora agotadas, desconocidas y vacías', () => {
    expect(varianteDeSku(vs, 'AB-200')).toBeNull();
    expect(varianteDeSku(vs, 'nada')).toBeNull();
    expect(varianteDeSku(vs, '')).toBeNull();
    expect(varianteDeSku(vs, null)).toBeNull();
  });
});
