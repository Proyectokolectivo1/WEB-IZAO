import { describe, expect, it } from 'vitest';
import { bannerDeCategoria, bannerVigente, enlaceBanner } from './banners';
import { varianteDeSku } from './ficha-util';
import type { Banner, VarianteProducto } from './types';

describe('enlaceBanner', () => {
  it('conserva tal cual rutas internas del país actual con variante, categorías y https', () => {
    expect(enlaceBanner('/co/perfume/aroma-uno?variante=ABC-100', 'co')).toBe('/co/perfume/aroma-uno?variante=ABC-100');
    expect(enlaceBanner(' /ec/categoria/damas ', 'ec')).toBe('/ec/categoria/damas');
    expect(enlaceBanner('/co', 'co')).toBe('/co');
    expect(enlaceBanner('/co?ref=x', 'co')).toBe('/co?ref=x');
    expect(enlaceBanner('https://wa.me/573000000000', 'co')).toBe('https://wa.me/573000000000');
  });
  it('descarta lo que no es seguro o está vacío', () => {
    for (const mal of [null, undefined, '', '   ', '//malo.com', 'javascript:alert(1)', 'http://inseguro.com', 'ftp://x', '/\\malo', 'perfume/x', 'data:text/html,x']) {
      expect(enlaceBanner(mal, 'co')).toBeNull();
    }
  });
  it('rechaza tabuladores, saltos de línea y caracteres de control (que no lleguen a //evil.com)', () => {
    const malos = [
      '/\t/evil.com',
      '/co/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '/co/a\u0000b',
      '/co/a\u007fb',
      '/co/a\u0085b',
      '/co/a\u00a0b',
      '/co/a b',
      'https://ex.com/a\tb',
      'https://ex.com/a\nb',
      '\t//evil.com',
    ];
    for (const mal of malos) expect(enlaceBanner(mal, 'co')).toBeNull();
  });
  it('solo rutas del país actual: ni otro país ni rutas sin país', () => {
    expect(enlaceBanner('/ec/catalogo', 'co')).toBeNull();
    expect(enlaceBanner('/co/catalogo', 'ec')).toBeNull();
    expect(enlaceBanner('/catalogo', 'co')).toBeNull();
    expect(enlaceBanner('/colombia/x', 'co')).toBeNull();
  });
  it('https exige servidor con punto, sin usuario ni clave y de largo razonable', () => {
    expect(enlaceBanner('https://localhost/x', 'co')).toBeNull();
    expect(enlaceBanner('https://user:pass@ex.com/x', 'co')).toBeNull();
    expect(enlaceBanner('https://' + 'a'.repeat(500) + '.com', 'co')).toBeNull();
  });
});

describe('bannerDeCategoria', () => {
  const m = { variants: {}, lqip: null };
  const b = (id: string, placement: Banner['placement'], category_slug?: string | null): Banner => ({
    id, placement, category_slug, desktop: m, mobile: m, alt: id, title: null, subtitle: null, cta_label: null, link_url: null, text_position: 'left', text_color: null,
  });
  const todos = [b('hero', 'hero'), b('damas', 'category', 'damas'), b('caballeros', 'category', 'caballeros'), b('generico', 'category', null)];
  it('cada categoría muestra solo el suyo', () => {
    expect(bannerDeCategoria(todos, 'damas')?.id).toBe('damas');
    expect(bannerDeCategoria(todos, 'caballeros')?.id).toBe('caballeros');
  });
  it('sin banner propio usa el genérico del país', () => {
    expect(bannerDeCategoria(todos, 'unisex')?.id).toBe('generico');
  });
  it('sin genérico, una categoría sin banner propio no muestra el de otra', () => {
    expect(bannerDeCategoria(todos.filter((x) => x.id !== 'generico'), 'unisex')).toBeNull();
    expect(bannerDeCategoria([b('hero', 'hero'), b('mid', 'mid')], 'damas')).toBeNull();
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
