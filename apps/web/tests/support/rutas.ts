/**
 * Rutas y selectores de la tienda pública. Las rutas con URL definida en la especificación (§5.1, §27)
 * son firmes; lo marcado "POR CONFIRMAR" lo fija izao-tienda al publicar y se ajusta aquí, en un solo lugar.
 */
import type { Pais } from './entorno';

export const RUTAS = {
  home: (p: Pais) => `/${p}`,
  /** Listado con scroll infinito: se prueba sobre una categoría del seed (URL de §27). */
  listado: (p: Pais, categoria = 'hombre') => `/${p}/categoria/${categoria}`,
  ficha: (p: Pais, slug: string) => `/${p}/perfume/${slug}`,
  /** POR CONFIRMAR con izao-tienda. */
  busqueda: (p: Pais, q: string) => `/${p}/buscar?q=${encodeURIComponent(q)}`,
  apiCatalogo: '/api/catalog',
  salud: '/api/health',
  adminLogin: '/admin/login',
} as const;

/** Clave de `localStorage` del carrito (§7.7). POR CONFIRMAR con izao-tienda. */
export const CLAVE_CARRITO = 'izao:cart';

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
