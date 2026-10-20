import { describe, expect, it } from 'vitest';
import { descripcionCorta, imagenesDe, jsonLdMigas, jsonLdProducto, rutaDeMedio, textoPlano } from './ficha-seo';
import type { FichaProducto } from './types';

const media = (w: number) => ({ variants: { '400': 'a/400.webp', '800': 'a/800.webp', '1600': 'a/1600.webp' }, width: w, height: w * 1.25 });

function ficha(extra: Partial<FichaProducto> = {}): FichaProducto {
  return {
    product_id: '00000000-0000-4000-8000-000000000001',
    slug: 'noche-de-ambar',
    name: 'Noche de Ámbar',
    brand_name: 'Casa Alba',
    brand_slug: 'casa-alba',
    gender_slug: 'mujer',
    family_slug: 'floral',
    concentration_slug: 'edp',
    min_price: 18990000,
    max_price: 25990000,
    compare_at_price: null,
    discount_pct: null,
    in_stock: true,
    variant_count: 2,
    img_primary: media(1600),
    img_hover: null,
    badges: [],
    rating_avg: 4.66,
    rating_count: 12,
    published_at: null,
    short_description: '<p>Un aroma <b>cálido</b> y envolvente.</p>',
    description_html: null,
    gender_name: 'Mujer',
    family_name: 'Floral',
    concentration_name: 'Eau de parfum',
    notes_top: [],
    notes_heart: [],
    notes_base: [],
    occasion: [],
    season: [],
    longevity: null,
    sillage: null,
    attributes: {},
    seo_title: null,
    seo_description: null,
    variants: [
      { id: 'v1', sku: 'NA-50', is_default: true, option_value_ids: [], price: 18990000, compare_at_price: null, stock_disponible: 4, in_stock: true, stock_bajo: false, image: null },
      { id: 'v2', sku: 'NA-100', is_default: false, option_value_ids: [], price: 25990000, compare_at_price: null, stock_disponible: 0, in_stock: false, stock_bajo: false, image: null },
    ],
    options: [],
    images: [],
    reviews: { avg: 4.66, count: 12, distribution: {}, latest: [] },
    ...extra,
  };
}

describe('textoPlano', () => {
  it('quita etiquetas y recorta en una palabra completa', () => {
    expect(textoPlano('<p>Hola   <b>mundo</b></p><script>x()</script>')).toBe('Hola mundo');
    const largo = textoPlano('palabra '.repeat(80), 50);
    expect(largo.length).toBeLessThanOrEqual(51);
    expect(largo.endsWith('…')).toBe(true);
  });
});

describe('rutaDeMedio / imagenesDe', () => {
  it('elige la variante más cercana por arriba y calcula el alto', () => {
    expect(rutaDeMedio(media(1600), 800)).toEqual({ ruta: '/media/a/800.webp', ancho: 800, alto: 1000 });
    expect(rutaDeMedio(media(1600), 5000)?.ruta).toBe('/media/a/1600.webp');
    expect(rutaDeMedio(null)).toBeNull();
  });
  it('usa la imagen principal si no hay galería y ordena por sort_order', () => {
    expect(imagenesDe(ficha())).toHaveLength(1);
    const a = media(800);
    const b = media(1600);
    expect(imagenesDe(ficha({ images: [{ role: 'g', sort_order: 2, media: a }, { role: 'g', sort_order: 1, media: b }] }))).toEqual([b, a]);
  });
});

describe('jsonLdProducto', () => {
  const ld = jsonLdProducto(ficha(), 'co', { sitio: 'https://izaoperfumeria.com', nombreTienda: 'Izao Perfumería' });

  it('no incluye brand ni afirmaciones de originalidad', () => {
    const texto = JSON.stringify(ld);
    expect(texto).not.toContain('"brand"');
    expect(texto).not.toContain('Casa Alba');
    expect(texto.toLowerCase()).not.toMatch(/original|aut[eé]ntic|certificad/);
  });
  it('arma Product con Offers por variante y precios en unidad mayor', () => {
    expect(ld['@type']).toBe('Product');
    const ofertas = ld['offers'] as { price: string; priceCurrency: string; availability: string }[];
    expect(ofertas).toHaveLength(2);
    expect(ofertas[0]).toMatchObject({ price: '18990000', priceCurrency: 'COP', availability: 'https://schema.org/InStock' });
    expect(ofertas[1]?.availability).toBe('https://schema.org/OutOfStock');
  });
  it('en USD escribe centavos como decimales', () => {
    const ec = jsonLdProducto(ficha({ variants: [{ ...ficha().variants[0]!, price: 4590 }] }), 'ec', { sitio: 'https://x.co', nombreTienda: 'Izao' });
    expect(ec['offers']).toMatchObject({ '@type': 'Offer', price: '45.90', priceCurrency: 'USD' });
  });
  it('incluye AggregateRating solo con reseñas e imágenes absolutas', () => {
    expect(ld['aggregateRating']).toMatchObject({ ratingValue: 4.7, reviewCount: 12 });
    expect(ld['image']).toEqual(['https://izaoperfumeria.com/media/a/1600.webp']);
    const sin = jsonLdProducto(ficha({ reviews: { avg: null, count: 0, distribution: {}, latest: [] } }), 'co', { sitio: 'https://x.co', nombreTienda: 'Izao' });
    expect(sin['aggregateRating']).toBeUndefined();
  });
  it('la descripción sale en texto plano', () => {
    expect(ld['description']).toBe('Un aroma cálido y envolvente.');
    expect(descripcionCorta(ficha({ short_description: null }))).toBeUndefined();
  });
});

describe('jsonLdMigas', () => {
  it('numera las posiciones y arma URLs absolutas', () => {
    const m = jsonLdMigas('co', 'https://x.co', [{ nombre: 'Inicio', ruta: '' }, { nombre: 'Aromas', ruta: '/catalogo' }]);
    expect(m.itemListElement[1]).toMatchObject({ position: 2, item: 'https://x.co/co/catalogo' });
  });
});
