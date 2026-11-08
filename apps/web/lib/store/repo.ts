/**
 * Acceso a datos de la tienda. La interfaz es lo único que conocen las páginas y las rutas:
 * `repo-supabase.ts` lee de la base (RPC `catalog_*` y selects públicos) y `repo-ejemplo.ts`
 * sirve datos tipados para desarrollar sin llaves. Todo es por país (§5.2).
 */
import 'server-only';
import type {
  AjustesTienda,
  Anuncio,
  Banner,
  CategoriaMenu,
  CodigoPais,
  ColeccionTab,
  CursorRpc,
  EspacioContenido,
  FichaProducto,
  FiltrosCatalogo,
  ItemCatalogo,
  OpcionesFiltros,
  OrdenCatalogo,
  PaginaCatalogo,
  PaginaLegal,
  PaginaListada,
  TipoPagina,
  ResenaHome,
  SeccionHome,
  Sugerencias,
  TemaGuardado,
} from './types';

export interface ConsultaCatalogo {
  q?: string;
  filtros: FiltrosCatalogo;
  orden: OrdenCatalogo;
  cursor: CursorRpc | null;
  limite: number;
  /** Pide también `total_estimado` (filtros y búsqueda). */
  conTotal?: boolean;
}

/** Carrusel de banners `hero` (home y catálogo) con sus ajustes del panel. */
export interface CarruselTienda {
  banners: Banner[];
  /** Segundos entre imágenes (3–30). */
  segundos: number;
  /** El panel puede apagar el carrusel en `/catalogo` sin tocar el del home. */
  enCatalogo: boolean;
}

export interface ContenidoHome {
  secciones: SeccionHome[];
  banners: Banner[];
  espacios: EspacioContenido[];
  colecciones: ColeccionTab[];
  resenas: ResenaHome[];
  familias: { slug: string; name: string; image: ItemCatalogo['img_primary'] }[];
  categorias: CategoriaMenu[];
}

export interface TiendaRepo {
  tema(pais: CodigoPais): Promise<TemaGuardado>;
  ajustes(pais: CodigoPais): Promise<AjustesTienda>;
  anuncios(pais: CodigoPais): Promise<Anuncio[]>;
  menu(pais: CodigoPais): Promise<CategoriaMenu[]>;
  opcionesFiltros(pais: CodigoPais): Promise<OpcionesFiltros>;
  catalogo(pais: CodigoPais, consulta: ConsultaCatalogo): Promise<PaginaCatalogo>;
  sugerencias(pais: CodigoPais, q: string, limite: number): Promise<Sugerencias>;
  busquedasPopulares(pais: CodigoPais): Promise<string[]>;
  producto(pais: CodigoPais, slug: string): Promise<FichaProducto | null>;
  relacionados(pais: CodigoPais, productoId: string, limite: number): Promise<ItemCatalogo[]>;
  home(pais: CodigoPais): Promise<ContenidoHome>;
  /** Solo el carrusel `hero` y sus ajustes (consulta liviana para `/catalogo`). */
  carrusel(pais: CodigoPais): Promise<CarruselTienda>;
  paginaLegal(pais: CodigoPais, slug: string): Promise<PaginaLegal | null>;
  /** Página publicada de un tipo (`pages.kind`, distinto de `general`); `null` si el país no la tiene publicada. */
  paginaPorTipo(pais: CodigoPais, kind: Exclude<TipoPagina, 'general'>): Promise<PaginaLegal | null>;
  /** Colección activa del país (nombre para el título de `/coleccion/{slug}`); `null` si no existe o está apagada. */
  coleccion(pais: CodigoPais, slug: string): Promise<{ slug: string; name: string } | null>;
  /** Imágenes y textos editables del sitio (`content_slots`), con el espacio del país por encima del global. */
  espacios(pais: CodigoPais): Promise<EspacioContenido[]>;
  /** Páginas y políticas publicadas del país, para el pie. */
  paginas(pais: CodigoPais): Promise<PaginaListada[]>;
}
