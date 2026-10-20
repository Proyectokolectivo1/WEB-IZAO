/**
 * Datos de ejemplo TIPADOS para desarrollar la tienda sin llaves de Supabase. Solo se usa cuando
 * `STORE_DATOS=ejemplo` (o no hay llaves y no es producción). Los nombres son inventados: no son marcas
 * ni productos reales. Imita el orden por claves y el cursor keyset de los RPC `catalog_*`.
 */
import 'server-only';
import type { ConsultaCatalogo, ContenidoHome, TiendaRepo } from './repo';
import type {
  AjustesTienda,
  CategoriaMenu,
  CodigoPais,
  FichaProducto,
  ItemCatalogo,
  OpcionesFiltros,
  PaginaCatalogo,
  VarianteProducto,
} from './types';

const MARCAS = [
  ['casa-alba', 'Casa Alba'],
  ['maison-brisa', 'Maison Brisa'],
  ['atelier-sur', 'Atelier Sur'],
  ['oud-y-lino', 'Oud y Lino'],
  ['bruma-norte', 'Bruma Norte'],
] as const;
const GENEROS = [
  ['mujer', 'Mujer'],
  ['hombre', 'Hombre'],
  ['unisex', 'Unisex'],
] as const;
const FAMILIAS = [
  ['floral', 'Floral'],
  ['amaderada', 'Amaderada'],
  ['citrica', 'Cítrica'],
  ['oriental', 'Oriental'],
  ['gourmand', 'Gourmand'],
] as const;
const CONCENTRACIONES = [
  ['edp', 'Eau de parfum'],
  ['edt', 'Eau de toilette'],
  ['extrait', 'Extrait'],
] as const;
const NOMBRES = [
  'Noche de Ámbar', 'Jardín de Seda', 'Sal y Cedro', 'Brisa de Limón', 'Rosa Ceniza', 'Humo Dulce', 'Vetiver Claro',
  'Tarde de Higo', 'Madera Lunar', 'Flor de Naranjo', 'Cuero Suave', 'Almendra Tibia', 'Té Blanco', 'Pimienta Rosa',
  'Lirio de Agua', 'Bosque Húmedo', 'Vainilla Seca', 'Iris Polvo', 'Oud Mate', 'Mandarina Verde',
];
const PRESENTACIONES = ['50 ml', '100 ml'] as const;

function prng(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Interno {
  item: ItemCatalogo;
  sort_featured: number;
  sales: number;
  ficha: FichaProducto;
}

function generar(pais: CodigoPais): Interno[] {
  const r = prng(pais === 'co' ? 7 : 11);
  const out: Interno[] = [];
  const factor = pais === 'co' ? 1 : 0.0003; // COP → USD en centavos: 1 COP ≈ 0.0003 USD = 0.03 ¢... se redondea abajo
  for (let i = 0; i < 140; i++) {
    if (pais === 'ec' && r() < 0.2) continue; // visibilidad distinta por país
    const [marcaSlug, marcaNombre] = MARCAS[i % MARCAS.length]!;
    const [generoSlug, generoNombre] = GENEROS[Math.floor(r() * 3)]!;
    const [familiaSlug, familiaNombre] = FAMILIAS[Math.floor(r() * 5)]!;
    const [concSlug, concNombre] = CONCENTRACIONES[Math.floor(r() * 3)]!;
    const nombre = `${NOMBRES[i % NOMBRES.length]!}${i >= NOMBRES.length ? ` ${Math.floor(i / NOMBRES.length) + 1}` : ''}`;
    const base = 90000 + Math.floor(r() * 25) * 10000;
    const enStock = r() > 0.12;
    const conDescuento = r() < 0.3;
    const pct = conDescuento ? 10 + Math.floor(r() * 4) * 5 : 0;
    const precio = (cop: number) => (pais === 'co' ? cop : Math.round(cop * factor * 100) * 1);
    const precio50 = precio(Math.round((base * (100 - pct)) / 100 / 1000) * 1000);
    const tachado50 = conDescuento ? precio(base) : null;
    const precio100 = precio(Math.round((base * 1.6 * (100 - pct)) / 100 / 1000) * 1000);
    const tachado100 = conDescuento ? precio(Math.round((base * 1.6) / 1000) * 1000) : null;
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const slug = `${nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${marcaSlug}-${i + 1}`;
    const badges = [...(r() < 0.15 ? ['new'] : []), ...(conDescuento && r() < 0.5 ? ['hot_sale'] : [])];
    const item: ItemCatalogo = {
      product_id: id,
      slug,
      name: nombre,
      brand_name: marcaNombre,
      brand_slug: marcaSlug,
      gender_slug: generoSlug,
      family_slug: familiaSlug,
      concentration_slug: concSlug,
      min_price: precio50,
      max_price: precio100,
      compare_at_price: tachado50,
      discount_pct: conDescuento ? pct : null,
      in_stock: enStock,
      variant_count: 2,
      img_primary: null,
      img_hover: null,
      badges,
      rating_avg: r() < 0.6 ? Math.round((4 + r()) * 10) / 10 : null,
      rating_count: 0,
      published_at: new Date(Date.UTC(2026, 0, 1) + i * 86400000 * 2).toISOString(),
    };
    if (item.rating_avg) item.rating_count = 3 + Math.floor(r() * 40);
    const variantes: VarianteProducto[] = PRESENTACIONES.map((_p, k) => ({
      id: `${id.slice(0, -2)}v${k}`,
      sku: null,
      is_default: k === 0,
      option_value_ids: [`ov-${k}`],
      price: k === 0 ? precio50 : precio100,
      compare_at_price: k === 0 ? tachado50 : tachado100,
      stock_disponible: enStock ? 12 : 0,
      in_stock: enStock,
      stock_bajo: false,
      image: null,
    }));
    out.push({
      item,
      sort_featured: Math.floor(r() * 1000) + (enStock ? 100000 : 0),
      sales: Math.floor(r() * 500),
      ficha: {
        ...item,
        short_description: `${concNombre} de carácter ${familiaNombre.toLowerCase()}, pensado para ${generoNombre.toLowerCase()}.`,
        description_html: `<p>${nombre} abre con notas frescas y se asienta en un fondo cálido que se queda contigo todo el día.</p>`,
        gender_name: generoNombre,
        family_name: familiaNombre,
        concentration_name: concNombre,
        notes_top: ['Bergamota', 'Pimienta rosa'],
        notes_heart: ['Iris', 'Jazmín'],
        notes_base: ['Ámbar', 'Cedro', 'Almizcle'],
        occasion: ['Diario', 'Noche'],
        season: ['Todo el año'],
        longevity: 'alta',
        sillage: 'media',
        attributes: {},
        seo_title: null,
        seo_description: null,
        variants: variantes,
        options: [{ id: 'op-1', name: 'Presentación', values: PRESENTACIONES.map((v, k) => ({ id: `ov-${k}`, value: v })) }],
        images: [],
        reviews: {
          avg: item.rating_avg,
          count: item.rating_count,
          distribution: item.rating_avg ? { '5': item.rating_count - 2, '4': 2 } : {},
          latest: item.rating_avg
            ? [{ author_name: 'Andrea M.', city: 'Medellín', rating: 5, body: 'Me encantó cómo se asienta en la piel.', is_verified_purchase: true, created_at: '2026-09-01T12:00:00Z' }]
            : [],
        },
      },
    });
  }
  return out;
}

const cache = new Map<CodigoPais, Interno[]>();
const datos = (p: CodigoPais) => {
  let d = cache.get(p);
  if (!d) cache.set(p, (d = generar(p)));
  return d;
};

function clave(i: Interno, orden: ConsultaCatalogo['orden']): number {
  switch (orden) {
    case 'sales':
      return i.sales;
    case 'newest':
      return Date.parse(i.item.published_at ?? '0');
    case 'price_asc':
      return i.item.min_price;
    case 'price_desc':
      return -i.item.min_price;
    case 'discount':
      return i.item.discount_pct ?? 0;
    default:
      return i.sort_featured;
  }
}

function plano(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function seleccionar(pais: CodigoPais, c: ConsultaCatalogo): Interno[] {
  const f = c.filtros;
  const q = c.q ? plano(c.q).split(' ').filter(Boolean) : [];
  const lista = datos(pais).filter(({ item: x }) => {
    if (f.gender && x.gender_slug !== f.gender) return false;
    if (f.brands?.length && !f.brands.includes(x.brand_slug ?? '')) return false;
    if (f.families?.length && !f.families.includes(x.family_slug ?? '')) return false;
    if (f.concentration && x.concentration_slug !== f.concentration) return false;
    if (f.availability && !x.in_stock) return false;
    if (f.price_min !== undefined && x.min_price < f.price_min) return false;
    if (f.price_max !== undefined && x.min_price > f.price_max) return false;
    if (q.length) {
      const texto = plano(`${x.name} ${x.brand_name} ${x.family_slug} ${x.gender_slug}`);
      if (!q.every((w) => texto.includes(w))) return false;
    }
    return true;
  });
  return lista.sort((a, b) => {
    const porStock = c.orden === 'featured' ? 0 : Number(b.item.in_stock) - Number(a.item.in_stock);
    return porStock || clave(b, c.orden) - clave(a, c.orden) || a.item.product_id.localeCompare(b.item.product_id);
  });
}

function categoriasEjemplo(): CategoriaMenu[] {
  return [
    { id: 'c1', name: 'Mujer', slug: 'mujer', image: null, children: [] },
    { id: 'c2', name: 'Hombre', slug: 'hombre', image: null, children: [] },
    {
      id: 'c3',
      name: 'Árabes',
      slug: 'arabes',
      image: null,
      children: [
        { id: 'c3a', name: 'Oud', slug: 'oud', image: null, children: [] },
        { id: 'c3b', name: 'Ámbar', slug: 'ambar', image: null, children: [] },
      ],
    },
  ];
}

export const repoEjemplo: TiendaRepo = {
  async tema() {
    return { colorTokens: {}, tipografia: {}, overridePais: null };
  },
  async ajustes(pais): Promise<AjustesTienda> {
    return {
      nombreTienda: 'Izao Perfumería',
      logo: null,
      ogImagen: null,
      redes: {},
      rotacionAnunciosSegundos: 4,
      whatsappAsesor: null,
      ocultarAgotados: false,
      moneda: pais === 'co' ? 'COP' : 'USD',
      nombrePais: pais === 'co' ? 'Colombia' : 'Ecuador',
      legal: {},
    };
  },
  async anuncios(pais) {
    return [
      { id: 'a1', text: 'Descuentos de hasta el 30 %', link_url: null, icon: null },
      { id: 'a2', text: pais === 'co' ? 'Envío gratis a toda Colombia' : 'Envío gratis a todo Ecuador', link_url: null, icon: null },
      ...(pais === 'co' ? [{ id: 'a3', text: 'Paga contra entrega', link_url: null, icon: null }] : []),
    ];
  },
  async menu() {
    return categoriasEjemplo();
  },
  async opcionesFiltros(pais): Promise<OpcionesFiltros> {
    const precios = datos(pais).map((d) => d.item.min_price);
    return {
      generos: GENEROS.map(([slug, name]) => ({ slug, name })),
      marcas: MARCAS.map(([slug, name]) => ({ slug, name })),
      familias: FAMILIAS.map(([slug, name]) => ({ slug, name })),
      concentraciones: CONCENTRACIONES.map(([slug, name]) => ({ slug, name })),
      categorias: [{ slug: 'arabes', name: 'Árabes' }],
      precioMin: Math.min(...precios),
      precioMax: Math.max(...datos(pais).map((d) => d.item.max_price)),
    };
  },
  async catalogo(pais, c): Promise<PaginaCatalogo> {
    const todos = seleccionar(pais, c);
    const cur = c.cursor ? String(c.cursor.id) : null;
    const desde = cur ? todos.findIndex((x) => x.item.product_id === cur) + 1 : 0;
    const items = todos.slice(desde, desde + c.limite).map((x) => x.item);
    const hay = desde + c.limite < todos.length;
    const ultimo = items[items.length - 1];
    return {
      items,
      next_cursor: hay && ultimo ? { o: c.orden, s: ultimo.in_stock ? 1 : 0, v: '0', id: ultimo.product_id } : null,
      total_estimado: c.conTotal || !c.cursor ? todos.length : null,
      precio_min: c.cursor ? null : Math.min(...datos(pais).map((d) => d.item.min_price)),
      precio_max: c.cursor ? null : Math.max(...datos(pais).map((d) => d.item.max_price)),
    };
  },
  async sugerencias(pais, q, limite) {
    const t = plano(q);
    const prod = datos(pais)
      .filter((d) => plano(d.item.name).includes(t) || plano(d.item.brand_name ?? '').includes(t))
      .slice(0, limite)
      .map(({ item: x }) => ({
        product_id: x.product_id,
        slug: x.slug,
        name: x.name,
        brand_name: x.brand_name,
        min_price: x.min_price,
        in_stock: x.in_stock,
        img_primary: null,
      }));
    return {
      productos: prod,
      marcas: MARCAS.filter(([, n]) => plano(n).includes(t)).map(([slug, name]) => ({ slug, name })),
      familias: FAMILIAS.filter(([, n]) => plano(n).includes(t)).map(([slug, name]) => ({ slug, name })),
    };
  },
  async busquedasPopulares() {
    return ['Floral', 'Ámbar', 'Cítrica'];
  },
  async producto(pais, slug) {
    return datos(pais).find((d) => d.item.slug === slug)?.ficha ?? null;
  },
  async relacionados(pais, id, limite) {
    const base = datos(pais).find((d) => d.item.product_id === id)?.item;
    if (!base) return [];
    return datos(pais)
      .filter(
        (d) =>
          d.item.product_id !== id &&
          d.item.in_stock &&
          d.item.family_slug === base.family_slug &&
          d.item.gender_slug === base.gender_slug,
      )
      .slice(0, limite)
      .map((d) => d.item);
  },
  async home(pais): Promise<ContenidoHome> {
    const destacados = seleccionar(pais, { filtros: {}, orden: 'featured', cursor: null, limite: 8 })
      .slice(0, 8)
      .map((d) => d.item);
    return {
      secciones: [
        { id: 's1', type: 'hero', config: {} },
        { id: 's2', type: 'categories', config: {} },
        { id: 's3', type: 'families', config: {} },
        { id: 's5', type: 'collection_tabs', config: {} },
        { id: 's8', type: 'reviews', config: {} },
      ],
      banners: [],
      espacios: [],
      colecciones: [{ id: 'col1', name: 'Más vendidos', slug: 'mas-vendidos', items: destacados }],
      resenas: [],
      familias: FAMILIAS.map(([slug, name]) => ({ slug, name, image: null })),
      categorias: categoriasEjemplo(),
    };
  },
  async paginaLegal() {
    return null;
  },
  async espacios() {
    return [];
  },
  async paginas() {
    return [];
  },
};
