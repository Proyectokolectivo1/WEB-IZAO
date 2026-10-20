/**
 * Rutas y selectores de la tienda pública. Las rutas con URL definida en la especificación (§5.1, §27)
 * son firmes; lo marcado "POR CONFIRMAR" lo fija izao-tienda al publicar y se ajusta aquí, en un solo lugar.
 */
import type { Pais } from './entorno';

export const RUTAS = {
  home: (p: Pais) => `/${p}`,
  /** Catálogo completo del país (todos los productos visibles). */
  catalogo: (p: Pais) => `/${p}/catalogo`,
  /** Listado con scroll infinito: se prueba sobre una categoría del seed (URL de §27). */
  listado: (p: Pais, categoria = 'hombre') => `/${p}/categoria/${categoria}`,
  ficha: (p: Pais, slug: string) => `/${p}/perfume/${slug}`,
  busqueda: (p: Pais, q: string) => `/${p}/buscar?q=${encodeURIComponent(q)}`,
  apiCatalogo: '/api/catalog',
  apiSugerencias: '/api/catalog/suggest',
  salud: '/api/health',
  adminLogin: '/admin/login',
} as const;

/** Clave de `localStorage` del carrito por país (§7.7); formato `{ v: 1, lineas: [...] }` (confirmado por izao-tienda). */
export const claveCarrito = (p: Pais) => `izao:carrito:${p}`;
export const claveDeseos = (p: Pais) => `izao:deseos:${p}`;
/** Valores de `orden` de la API (confirmados por izao-tienda). */
export const ORDENES = ['featured', 'sales', 'newest', 'price_asc', 'price_desc', 'discount'] as const;

/**
 * Contrato de selectores que se pide a izao-tienda (`data-testid`). Si cambian, se cambian aquí.
 * Tarjeta: `tarjeta-producto` con `data-product-id` y `data-slug`.
 */
export const SEL = {
  tarjeta: '[data-testid="tarjeta-producto"]',
  centinela: '[data-testid="centinela-scroll"]',
  finResultados: '[data-testid="fin-resultados"]',
  imagenPrincipal: '[data-testid="tarjeta-imagen-principal"]',
  imagenHover: '[data-testid="tarjeta-imagen-hover"]',
  puntosGaleria: '[data-testid="tarjeta-puntos"]',
  botonVistaRapida: '[data-testid="boton-vista-rapida"]',
  vistaRapida: '[role="dialog"][data-testid="vista-rapida"]',
  botonAgregar: '[data-testid="boton-agregar"]',
  contadorCarrito: '[data-testid="contador-carrito"]',
  filtrosAbrir: '[data-testid="abrir-filtros"]',
  chipFiltro: '[data-testid="chip-filtro"]',
  limpiarFiltros: '[data-testid="limpiar-filtros"]',
  orden: '[data-testid="selector-orden"]',
  precioMin: '[data-testid="precio-min"]',
  precioMax: '[data-testid="precio-max"]',
  buscador: 'input[type="search"], [role="searchbox"]',
  sugerencias: '[data-testid="sugerencias-busqueda"]',
} as const;
