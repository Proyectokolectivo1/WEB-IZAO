/**
 * Envoltorios tipados de los RPC del catálogo (`20261020042322_rpc_catalogo.sql`, §7).
 *
 * SOLO SERVIDOR. Entradas y salidas se validan con zod. Los nombres de campo son los de la base
 * (snake_case) para no traducir dos veces; los montos son enteros en unidad menor del país
 * (COP exponente 0, USD exponente 2) y se muestran con `@izao/core/money`.
 */
import 'server-only';
import { z } from 'zod';
import { llamarRpc } from './cliente';

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────

/** Acepta `co`/`ec` (rutas) o `CO`/`EC` (base) y entrega el código de la base. */
export const paisSchema = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.enum(['CO', 'EC']));
export type PaisEntrada = z.input<typeof paisSchema>;

const slug = z.string().trim().min(1).max(120);
const monto = z.number().int().nonnegative();

export const filtrosCatalogoSchema = z
  .object({
    gender: slug.optional(),
    brands: z.array(slug).max(50).optional(),
    families: z.array(slug).max(50).optional(),
    concentration: slug.optional(),
    category: slug.optional(),
    /** Slug de la colección del país (manual o por regla); inexistente o inactiva: página vacía. */
    collection: slug.optional(),
    availability: z.literal('in_stock').optional(),
    price_min: monto.optional(),
    price_max: monto.optional(),
    /** Pide `total_estimado` (cuesta un `count`; úsalo solo con filtros o búsqueda). */
    with_total: z.boolean().optional(),
  })
  .strict();
export type FiltrosCatalogoDb = z.infer<typeof filtrosCatalogoSchema>;

export const ordenesListado = ['featured', 'sales', 'newest', 'price_asc', 'price_desc', 'discount'] as const;
export const ordenesBusqueda = [...ordenesListado, 'relevance'] as const;
export type OrdenListado = (typeof ordenesListado)[number];
export type OrdenBusqueda = (typeof ordenesBusqueda)[number];

/** Cursor opaco `{o, s, v, id}` tal como lo devuelve el RPC. Se pasa de vuelta sin tocarlo. */
export const cursorSchema = z
  .object({
    o: z.string().max(20),
    s: z.number().int().min(0).max(1),
    v: z.string().max(200).nullable(),
    id: z.uuid(),
  })
  .strict();
export type CursorCatalogo = z.infer<typeof cursorSchema>;

const limite = (max: number) => z.number().int().min(1).max(max);

// ── Salidas ──────────────────────────────────────────────────────────────────────────────────────

export const mediaSchema = z.object({
  media_id: z.uuid().optional(),
  base_path: z.string().optional(),
  variants: z.record(z.string(), z.string()).nullable().optional(),
  lqip: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
});
export type MediaDb = z.infer<typeof mediaSchema>;

export const itemCatalogoSchema = z.object({
  product_id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  brand_name: z.string().nullable(),
  brand_slug: z.string().nullable(),
  gender_slug: z.string().nullable(),
  family_slug: z.string().nullable(),
  concentration_slug: z.string().nullable(),
  min_price: monto,
  max_price: monto,
  compare_at_price: monto.nullable(),
  discount_pct: z.number().int().nullable(),
  in_stock: z.boolean(),
  variant_count: z.number().int(),
  img_primary: mediaSchema.nullable(),
  img_hover: mediaSchema.nullable(),
  badges: z.array(z.string()),
  rating_avg: z.number().nullable(),
  rating_count: z.number().int(),
  published_at: z.string().nullable(),
});
export type ItemCatalogoDb = z.infer<typeof itemCatalogoSchema>;

export const paginaCatalogoSchema = z.object({
  items: z.array(itemCatalogoSchema),
  next_cursor: cursorSchema.nullable(),
  total_estimado: z.number().int().nullable(),
  precio_min: monto.nullable(),
  precio_max: monto.nullable(),
});
export type PaginaCatalogoDb = z.infer<typeof paginaCatalogoSchema>;

export const sugerenciasSchema = z.object({
  productos: z.array(
    itemCatalogoSchema.pick({
      product_id: true,
      slug: true,
      name: true,
      brand_name: true,
      min_price: true,
      in_stock: true,
      img_primary: true,
    }),
  ),
  marcas: z.array(z.object({ slug: z.string(), name: z.string() })),
  familias: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export type SugerenciasDb = z.infer<typeof sugerenciasSchema>;

const textos = z.array(z.string());

export const fichaProductoSchema = itemCatalogoSchema.extend({
  short_description: z.string().nullable(),
  description_html: z.string().nullable(),
  gender_name: z.string().nullable(),
  family_name: z.string().nullable(),
  concentration_name: z.string().nullable(),
  notes_top: textos,
  notes_heart: textos,
  notes_base: textos,
  occasion: textos,
  season: textos,
  longevity: z.string().nullable(),
  sillage: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  seo_title: z.string().nullable(),
  seo_description: z.string().nullable(),
  variants: z.array(
    z.object({
      id: z.uuid(),
      sku: z.string(),
      is_default: z.boolean(),
      option_value_ids: z.array(z.uuid()),
      price: monto,
      compare_at_price: monto.nullable(),
      stock_disponible: z.number().int().nonnegative(),
      in_stock: z.boolean(),
      stock_bajo: z.boolean(),
      image: mediaSchema.nullable(),
    }),
  ),
  options: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      values: z.array(z.object({ id: z.uuid(), value: z.string() })),
    }),
  ),
  images: z.array(
    z.object({ role: z.string(), sort_order: z.number().int(), media: mediaSchema }),
  ),
  reviews: z.object({
    avg: z.number().nullable(),
    count: z.number().int(),
    distribution: z.record(z.string(), z.number().int()),
    latest: z.array(
      z.object({
        author_name: z.string(),
        city: z.string().nullable(),
        rating: z.number().int(),
        body: z.string().nullable(),
        is_verified_purchase: z.boolean(),
        created_at: z.string(),
      }),
    ),
  }),
});
export type FichaProductoDb = z.infer<typeof fichaProductoSchema>;

// ── Funciones ────────────────────────────────────────────────────────────────────────────────────

export interface ConsultaListado {
  filtros?: FiltrosCatalogoDb;
  orden?: OrdenListado;
  cursor?: CursorCatalogo | null;
  limite?: number;
}

const consultaListadoSchema = z.object({
  filtros: filtrosCatalogoSchema.default({}),
  orden: z.enum(ordenesListado).default('featured'),
  cursor: cursorSchema.nullable().default(null),
  limite: limite(60).default(25),
});

/** Lote del listado con keyset (25 por defecto, máximo 60). */
export async function catalogPage(pais: PaisEntrada, consulta: ConsultaListado = {}): Promise<PaginaCatalogoDb> {
  const c = consultaListadoSchema.parse(consulta);
  return llamarRpc(
    'catalog_page',
    { p_country: paisSchema.parse(pais), p_filters: c.filtros, p_sort: c.orden, p_cursor: c.cursor, p_limit: c.limite },
    paginaCatalogoSchema,
  );
}

export interface ConsultaBusqueda {
  q: string;
  filtros?: FiltrosCatalogoDb;
  orden?: OrdenBusqueda;
  cursor?: CursorCatalogo | null;
  limite?: number;
}

const consultaBusquedaSchema = z.object({
  q: z.string().trim().max(100),
  filtros: filtrosCatalogoSchema.default({}),
  orden: z.enum(ordenesBusqueda).default('relevance'),
  cursor: cursorSchema.nullable().default(null),
  limite: limite(60).default(25),
});

/** Búsqueda con el mismo cursor y forma que `catalogPage`. Un `q` vacío devuelve una página vacía. */
export async function catalogSearchPage(pais: PaisEntrada, consulta: ConsultaBusqueda): Promise<PaginaCatalogoDb> {
  const c = consultaBusquedaSchema.parse(consulta);
  return llamarRpc(
    'catalog_search_page',
    {
      p_country: paisSchema.parse(pais),
      p_q: c.q,
      p_filters: c.filtros,
      p_sort: c.orden,
      p_cursor: c.cursor,
      p_limit: c.limite,
    },
    paginaCatalogoSchema,
  );
}

/** Sugerencias en vivo `{productos, marcas, familias}` (máximo 20 productos). */
export async function catalogSuggest(pais: PaisEntrada, q: string, lim = 6): Promise<SugerenciasDb> {
  return llamarRpc(
    'catalog_suggest',
    { p_country: paisSchema.parse(pais), p_q: z.string().trim().max(100).parse(q), p_limit: limite(20).parse(lim) },
    sugerenciasSchema,
  );
}

/** Ficha completa del producto visible en el país, o `null` si no existe o no está visible. */
export async function catalogProduct(pais: PaisEntrada, slugProducto: string): Promise<FichaProductoDb | null> {
  return llamarRpc(
    'catalog_product',
    { p_country: paisSchema.parse(pais), p_slug: slug.parse(slugProducto) },
    fichaProductoSchema.nullable(),
  );
}

/** "También te puede gustar": misma familia y género, visibles y en stock (máximo 24). */
export async function catalogRelated(pais: PaisEntrada, productoId: string, lim = 8): Promise<ItemCatalogoDb[]> {
  return llamarRpc(
    'catalog_related',
    { p_country: paisSchema.parse(pais), p_product_id: z.uuid().parse(productoId), p_limit: limite(24).parse(lim) },
    z.array(itemCatalogoSchema),
  );
}
