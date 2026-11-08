import type { Banner, CodigoPais } from './types';

// Controles C0/C1, DEL, cualquier espacio (incluye tabulador, saltos de línea y NBSP) y barra invertida.
// eslint-disable-next-line no-control-regex
const NO_PERMITIDO = /[\u0000-\u001f\u007f-\u009f\s\\]/;
const MAX_URL = 500;

/**
 * `link_url` del banner tal como lo guarda el panel (D-045). Solo se sigue si es:
 * - una ruta interna del país actual (`/{país}`, `/{país}/…`; el panel no permite cruzar de país), o
 * - una dirección https con servidor (sin usuario ni clave).
 * Se descarta lo demás: vacío, `//host`, `javascript:`, http, barras invertidas, espacios, tabuladores, saltos de línea y
 * cualquier carácter de control (los navegadores los quitan: una ruta con tabulador tras la primera barra terminaría
 * en `//evil.com`).
 * Misma regla que `esUrlDestinoValida` del panel (apps/web/lib/admin/banners), copiada porque ese módulo trae `zod` y
 * este corre en el navegador.
 */
export function enlaceBanner(url: string | null | undefined, pais: CodigoPais): string | null {
  const t = typeof url === 'string' ? url.trim() : '';
  if (!t || t.length > MAX_URL || NO_PERMITIDO.test(t)) return null;
  if (t.startsWith('/')) return new RegExp(`^/${pais}(?:[/?#]|$)`).test(t) ? t : null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password ? t : null;
  } catch {
    return null;
  }
}

/** Vigente en `ahora`: ya empezó y no ha terminado (sin fechas = siempre). */
export function bannerVigente(b: { starts_at?: string | null; ends_at?: string | null }, ahora: Date): boolean {
  const t = ahora.getTime();
  if (b.starts_at && new Date(b.starts_at).getTime() > t) return false;
  if (b.ends_at && new Date(b.ends_at).getTime() <= t) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ajustes del carrusel (se editan en el panel: `home_sections.config` de la sección `hero` de cada país)
// ---------------------------------------------------------------------------------------------------------------------

/** Tiempo entre imágenes: defecto de la semilla y límites que acepta el panel (el carrusel los aplica también al leer). */
export const CARRUSEL_SEGUNDOS = { defecto: 6, minimo: 3, maximo: 30 } as const;

/** Segundos entre imágenes según `config.interval_seconds`; fuera de rango o ausente → defecto/limite. */
export function segundosCarrusel(config: Record<string, unknown> | null | undefined): number {
  const v = config?.['interval_seconds'];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return CARRUSEL_SEGUNDOS.defecto;
  return Math.min(CARRUSEL_SEGUNDOS.maximo, Math.max(CARRUSEL_SEGUNDOS.minimo, Math.round(n)));
}

/** El catálogo repite el carrusel del home salvo que el panel lo apague (`config.show_in_catalog === false`). */
export const carruselEnCatalogo = (config: Record<string, unknown> | null | undefined): boolean => config?.['show_in_catalog'] !== false;

export const bannersDe = (banners: readonly Banner[], ubicacion: Banner['placement']): Banner[] => banners.filter((b) => b.placement === ubicacion);

/**
 * Banner de la cabecera de una categoría: el de ESA categoría (`category_slug`); si no hay, el genérico del país
 * (`category` sin categoría). Nunca el de otra categoría.
 */
export function bannerDeCategoria(banners: readonly Banner[], slug: string): Banner | null {
  const propios = bannersDe(banners, 'category');
  return propios.find((b) => b.category_slug === slug) ?? propios.find((b) => !b.category_slug) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Banner con UNA sola imagen responsive (D-047)
// ---------------------------------------------------------------------------------------------------------------------

/** Punto focal (`banners.focal_x/focal_y`, 0–100, defecto 50/50 en la base). Si llega vacío o inválido se usa el centro. */
export const FOCAL_DEFECTO = 50;

const enteroFocal = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : FOCAL_DEFECTO;
};

/** `object-position` del recorte en pantallas angostas: `{focal_x}% {focal_y}%` (50 % 50 % si faltan o son inválidos). */
export const puntoFocal = (b: { focal_x?: number | null; focal_y?: number | null }): string => `${enteroFocal(b.focal_x)}% ${enteroFocal(b.focal_y)}%`;

/**
 * Banner nuevo = una sola imagen (`mobile_media_id` = `desktop_media_id`) o sin imagen móvil.
 * Banner antiguo = imagen móvil distinta: se sirve con `<picture>`.
 */
export function esImagenUnica(b: { desktop_media_id?: string | null; mobile_media_id?: string | null }): boolean {
  return !b.mobile_media_id || b.mobile_media_id === b.desktop_media_id;
}

/**
 * Caja de un banner de imagen única: sigue la proporción REAL de la imagen para que se vea completa en todas las pantallas
 * (sin recorte). Sin dimensiones del original, cae a las proporciones por breakpoint de `CAJA_UNICA`.
 */
export function cajaImagenUnica(
  b: { desktop?: { width?: number | null; height?: number | null } | null },
  ubicacion: UbicacionBanner,
): { className: string; style?: { aspectRatio: string } } {
  const w = b.desktop?.width;
  const h = b.desktop?.height;
  if (w && h && w > 0 && h > 0) return { className: '', style: { aspectRatio: `${w} / ${h}` } };
  return { className: CAJA_UNICA[ubicacion].clase };
}

export type UbicacionBanner = 'hero' | 'mid' | 'category';

interface CajaBanner {
  /** Ancho mínimo de pantalla (px) desde el que vale esta proporción; coincide con el prefijo de Tailwind (`sm` 640, `lg` 1024). */
  desde: number;
  /** ancho / alto de la caja del banner. */
  ratio: number;
}

/**
 * Alto del recuadro por breakpoint cuando hay UNA sola imagen: la caja fija la altura y la imagen la cubre con
 * `object-fit: cover`. La clase y la tabla de proporciones van juntas: si cambias una, cambia la otra (hay prueba).
 * Los tamaños recomendados del panel son hero 2400×1000 (12:5), mid 2400×750 (16:5), categoría 2400×625 (≈19:5).
 */
export const CAJA_UNICA: Record<UbicacionBanner, { clase: string; cajas: readonly CajaBanner[] }> = {
  hero: { clase: 'aspect-square sm:aspect-[3/2] lg:aspect-[12/5]', cajas: [{ desde: 0, ratio: 1 }, { desde: 640, ratio: 3 / 2 }, { desde: 1024, ratio: 12 / 5 }] },
  mid: { clase: 'aspect-[5/4] sm:aspect-[16/7] lg:aspect-[16/5]', cajas: [{ desde: 0, ratio: 5 / 4 }, { desde: 640, ratio: 16 / 7 }, { desde: 1024, ratio: 16 / 5 }] },
  category: { clase: 'aspect-[4/3] sm:aspect-[16/6] lg:aspect-[1920/500]', cajas: [{ desde: 0, ratio: 4 / 3 }, { desde: 640, ratio: 16 / 6 }, { desde: 1024, ratio: 1920 / 500 }] },
};

/** Proporciones de los banners antiguos (imagen móvil propia), también en `Hero` (4:5 → 12:5), `mid` y `category`. */
export const CAJA_ANTIGUA = {
  hero: 'aspect-[4/5] md:aspect-[12/5]',
  mid: 'aspect-square sm:aspect-[16/7] lg:aspect-[16/5]',
  category: 'aspect-[6/5] sm:aspect-[16/6] lg:aspect-[1920/500]',
} as const;

// El banner va dentro del contenedor de la página: máx. 96 rem (1536 px) con 1 rem de relleno por lado (2 rem desde 640 px).
const CONTENEDOR_MAX_PX = 1472;

/**
 * `sizes` de la imagen única. Con `object-fit: cover` la imagen se dibuja MÁS ANCHA que su caja cuando es más panorámica
 * que ella (en un móvil con caja 1:1 y foto 12:5, 2,4 veces el ancho de la caja): se compensa con ese factor para que el
 * navegador pida la variante que de verdad necesita y no una borrosa. Sin dimensiones del original, factor 1.
 */
export function sizesImagenUnica(ubicacion: UbicacionBanner, ratioImagen: number | null): string {
  const { cajas } = CAJA_UNICA[ubicacion];
  const factor = (caja: CajaBanner) => (ratioImagen && ratioImagen > 0 ? Math.max(1, ratioImagen / caja.ratio) : 1);
  const num = (n: number) => String(Math.round(n * 1000) / 1000);
  const tramos: string[] = [];
  const ultima = cajas[cajas.length - 1]!;
  tramos.push(`(min-width: 1536px) ${num(CONTENEDOR_MAX_PX * factor(ultima))}px`);
  for (const caja of [...cajas].reverse()) {
    const relleno = caja.desde >= 640 ? '4rem' : '2rem';
    const f = factor(caja);
    const ancho = f === 1 ? `calc(100vw - ${relleno})` : `calc((100vw - ${relleno}) * ${num(f)})`;
    tramos.push(caja.desde === 0 ? ancho : `(min-width: ${caja.desde}px) ${ancho}`);
  }
  return tramos.join(', ');
}
