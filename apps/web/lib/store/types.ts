/**
 * Tipos de lo que la tienda lee de la base. Reflejan la salida de los RPC `catalog_*`
 * (`20261020042322_rpc_catalogo.sql`) y las tablas de contenido (§6.2). Los montos son enteros en
 * unidad menor (JSON number); para mostrarlos se pasan por `formatearPrecio` (`@izao/core/money`).
 */
import type { MediaJson } from '@izao/ui';

export type CodigoPais = 'co' | 'ec';

export type MediaRef = MediaJson & { media_id?: string; base_path?: string };

export type OrdenCatalogo = 'featured' | 'sales' | 'newest' | 'price_asc' | 'price_desc' | 'discount' | 'relevance';

export interface FiltrosCatalogo {
  gender?: string;
  brands?: string[];
  families?: string[];
  concentration?: string;
  category?: string;
  /** Slug de la colección del país (rutas `/coleccion/{slug}`; no va en la URL de filtros). */
  collection?: string;
  availability?: 'in_stock';
  price_min?: number;
  price_max?: number;
}

export interface ItemCatalogo {
  product_id: string;
  slug: string;
  name: string;
  brand_name: string | null;
  brand_slug: string | null;
  gender_slug: string | null;
  family_slug: string | null;
  concentration_slug: string | null;
  min_price: number;
  max_price: number;
  compare_at_price: number | null;
  discount_pct: number | null;
  in_stock: boolean;
  variant_count: number;
  img_primary: MediaRef | null;
  img_hover: MediaRef | null;
  badges: string[];
  rating_avg: number | null;
  rating_count: number;
  published_at: string | null;
}

/** Cursor opaco tal como lo entrega el RPC (`{o, s, v, id}`). */
export type CursorRpc = Record<string, unknown>;

export interface PaginaCatalogo {
  items: ItemCatalogo[];
  next_cursor: CursorRpc | null;
  total_estimado: number | null;
  precio_min: number | null;
  precio_max: number | null;
}

export interface Sugerencias {
  productos: Pick<ItemCatalogo, 'product_id' | 'slug' | 'name' | 'brand_name' | 'min_price' | 'in_stock' | 'img_primary'>[];
  marcas: { slug: string; name: string }[];
  familias: { slug: string; name: string }[];
}

export interface VarianteProducto {
  id: string;
  sku: string | null;
  is_default: boolean;
  option_value_ids: string[];
  price: number;
  compare_at_price: number | null;
  stock_disponible: number;
  in_stock: boolean;
  stock_bajo: boolean;
  image: MediaRef | null;
}

export interface OpcionProducto {
  id: string;
  name: string;
  values: { id: string; value: string }[];
}

export interface ResenaProducto {
  author_name: string;
  city: string | null;
  rating: number;
  body: string | null;
  is_verified_purchase: boolean;
  created_at: string;
}

export interface FichaProducto extends ItemCatalogo {
  short_description: string | null;
  description_html: string | null;
  gender_name: string | null;
  family_name: string | null;
  concentration_name: string | null;
  notes_top: string[];
  notes_heart: string[];
  notes_base: string[];
  occasion: string[];
  season: string[];
  longevity: 'baja' | 'media' | 'alta' | 'muy_alta' | null;
  sillage: 'baja' | 'media' | 'alta' | 'muy_alta' | null;
  attributes: Record<string, unknown>;
  seo_title: string | null;
  seo_description: string | null;
  variants: VarianteProducto[];
  options: OpcionProducto[];
  images: { role: string; sort_order: number; media: MediaRef }[];
  reviews: {
    avg: number | null;
    count: number;
    distribution: Record<string, number>;
    latest: ResenaProducto[];
  };
}

// --- Contenido y configuración por país -----------------------------------------------------------------

export interface TemaGuardado {
  /** `site_settings.color_tokens` */
  colorTokens: Record<string, unknown>;
  /** `site_settings.typography` */
  tipografia: Record<string, unknown>;
  /** `theme_overrides.tokens` del país (puede traer colores y tipografía). */
  overridePais: Record<string, unknown> | null;
}

export interface AjustesTienda {
  nombreTienda: string;
  logo: MediaRef | null;
  ogImagen: MediaRef | null;
  redes: Record<string, string>;
  /** `country_settings` público del país. */
  rotacionAnunciosSegundos: number;
  whatsappAsesor: string | null;
  ocultarAgotados: boolean;
  /** Código de moneda del país (`COP`, `USD`). */
  moneda: 'COP' | 'USD';
  nombrePais: string;
  /** Datos de contacto y legales para el pie (pueden traer marcadores [COMPLETAR]). */
  legal: Record<string, string>;
}

export interface Anuncio {
  id: string;
  text: string;
  link_url: string | null;
  icon: string | null;
}

export interface CategoriaMenu {
  id: string;
  name: string;
  slug: string;
  image: MediaRef | null;
  children: CategoriaMenu[];
}

export interface Banner {
  id: string;
  placement: 'hero' | 'mid' | 'category';
  desktop: MediaRef;
  mobile: MediaRef;
  alt: string;
  title: string | null;
  subtitle: string | null;
  cta_label: string | null;
  link_url: string | null;
  text_position: 'left' | 'center' | 'right';
  text_color: string | null;
}

export interface SeccionHome {
  id: string;
  type: 'hero' | 'categories' | 'families' | 'collection_tabs' | 'advice' | 'benefits' | 'reviews' | 'banner';
  config: Record<string, unknown>;
}

export interface ColeccionTab {
  id: string;
  name: string;
  slug: string;
  items: ItemCatalogo[];
}

export interface EspacioContenido {
  key: string;
  title: string | null;
  body: string | null;
  link_url: string | null;
  media: MediaRef | null;
  mobile_media: MediaRef | null;
}

export interface OpcionFiltro {
  slug: string;
  name: string;
}

export interface OpcionesFiltros {
  generos: OpcionFiltro[];
  marcas: OpcionFiltro[];
  familias: OpcionFiltro[];
  concentraciones: OpcionFiltro[];
  categorias: OpcionFiltro[];
  precioMin: number;
  precioMax: number;
}

export interface ResenaHome {
  id: string;
  author_name: string;
  city: string | null;
  rating: number;
  body: string | null;
}

export interface PaginaLegal {
  slug: string;
  title: string;
  content_html: string;
  version: number;
  updated_at: string;
  seo_title: string | null;
  seo_description: string | null;
}
