import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { catalogPage, catalogProduct, catalogRelated, catalogSearchPage, catalogSuggest } from './catalogo';

const PID = '439a4f26-278c-4dbd-a9da-1b74672df264';

const item = {
  product_id: PID,
  slug: 'bruma-silvestre',
  name: 'Bruma Silvestre',
  brand_name: 'Canela Sur',
  brand_slug: 'canela-sur',
  gender_slug: 'hombre',
  family_slug: 'amaderada',
  concentration_slug: 'edt',
  min_price: 120000,
  max_price: 469000,
  compare_at_price: null,
  discount_pct: 0,
  in_stock: true,
  variant_count: 3,
  img_primary: { media_id: PID, base_path: 'pruebas/p1', variants: { '400': 'pruebas/p1-400.webp' }, lqip: null, alt: 'Frasco', width: 1200, height: 1500 },
  img_hover: null,
  badges: ['hot_sale'],
  rating_avg: null,
  rating_count: 0,
  published_at: '2026-10-01T00:00:00+00:00',
};

const pagina = {
  items: [item],
  next_cursor: { o: 'price_asc', s: 1, v: '120000', id: PID },
  total_estimado: 400,
  precio_min: 120000,
  precio_max: 519000,
};

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('catalogPage', () => {
  it('pasa el país en mayúsculas, valores por defecto y devuelve la página validada', async () => {
    const rpc = clienteFalso(pagina);
    const r = await catalogPage('co');
    expect(rpc).toHaveBeenCalledWith('catalog_page', {
      p_country: 'CO',
      p_filters: {},
      p_sort: 'featured',
      p_cursor: null,
      p_limit: 25,
    });
    expect(r.items[0]?.min_price).toBe(120000);
    expect(r.next_cursor?.v).toBe('120000');
  });

  it('reenvía el cursor y los filtros', async () => {
    const rpc = clienteFalso({ ...pagina, next_cursor: null });
    await catalogPage('EC', {
      filtros: { brands: ['ocelo'], price_max: 9900, with_total: true },
      orden: 'price_asc',
      cursor: pagina.next_cursor,
      limite: 10,
    });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_country: 'EC',
      p_filters: { brands: ['ocelo'], price_max: 9900, with_total: true },
      p_cursor: pagina.next_cursor,
      p_limit: 10,
    });
  });

  it('rechaza un país, un filtro o un límite inválidos antes de llamar a la base', async () => {
    const rpc = clienteFalso(pagina);
    await expect(catalogPage('mx')).rejects.toThrow();
    await expect(catalogPage('co', { filtros: { color: 'rojo' } as never })).rejects.toThrow();
    await expect(catalogPage('co', { limite: 500 })).rejects.toThrow();
    await expect(catalogPage('co', { filtros: { price_min: 10.5 } })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('un error del RPC o una forma inesperada lanzan ErrorDb', async () => {
    clienteFalso(null, { message: 'permission denied', code: '42501' });
    await expect(catalogPage('co')).rejects.toMatchObject({ name: 'ErrorDb', motivo: 'rpc', codigo: '42501' });
    clienteFalso({ ...pagina, items: [{ ...item, min_price: 1.5 }] });
    const e = await catalogPage('co').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorDb);
    expect((e as ErrorDb).motivo).toBe('forma');
  });
});

describe('búsqueda, sugerencias, ficha y relacionados', () => {
  it('catalogSearchPage usa relevance por defecto', async () => {
    const rpc = clienteFalso(pagina);
    await catalogSearchPage('co', { q: '  flor ' });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_q: 'flor', p_sort: 'relevance' });
  });

  it('catalogSuggest valida productos, marcas y familias', async () => {
    const rpc = clienteFalso({
      productos: [{ product_id: PID, slug: 'a', name: 'A', brand_name: null, min_price: 1, in_stock: true, img_primary: null }],
      marcas: [],
      familias: [{ slug: 'floral', name: 'Floral' }],
    });
    const r = await catalogSuggest('co', 'flo');
    expect(rpc).toHaveBeenCalledWith('catalog_suggest', { p_country: 'CO', p_q: 'flo', p_limit: 6 });
    expect(r.familias).toHaveLength(1);
  });

  it('catalogProduct devuelve null cuando el producto no está visible', async () => {
    clienteFalso(null);
    expect(await catalogProduct('co', 'no-existe')).toBeNull();
  });

  it('catalogProduct valida la ficha completa', async () => {
    clienteFalso({
      ...item,
      short_description: 'x',
      description_html: null,
      gender_name: 'Hombre',
      family_name: 'Amaderada',
      concentration_name: 'EDT',
      notes_top: ['cardamomo'],
      notes_heart: [],
      notes_base: [],
      occasion: [],
      season: [],
      longevity: 'media',
      sillage: 'media',
      attributes: {},
      seo_title: null,
      seo_description: null,
      variants: [
        {
          id: PID,
          sku: 'IZ-1',
          is_default: true,
          option_value_ids: [],
          price: 120000,
          compare_at_price: null,
          stock_disponible: 3,
          in_stock: true,
          stock_bajo: true,
          image: null,
        },
      ],
      options: [],
      images: [],
      reviews: { avg: null, count: 0, distribution: { '1': 0 }, latest: [] },
    });
    const f = await catalogProduct('co', 'bruma-silvestre');
    expect(f?.variants[0]?.stock_bajo).toBe(true);
  });

  it('catalogRelated exige un uuid y un límite de hasta 24', async () => {
    const rpc = clienteFalso([item]);
    expect(await catalogRelated('co', PID)).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('catalog_related', { p_country: 'CO', p_product_id: PID, p_limit: 8 });
    await expect(catalogRelated('co', 'no-uuid')).rejects.toThrow();
    await expect(catalogRelated('co', PID, 30)).rejects.toThrow();
  });
});
