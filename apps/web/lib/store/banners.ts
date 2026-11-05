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

export const bannersDe = (banners: readonly Banner[], ubicacion: Banner['placement']): Banner[] => banners.filter((b) => b.placement === ubicacion);

/**
 * Banner de la cabecera de una categoría: el de ESA categoría (`category_slug`); si no hay, el genérico del país
 * (`category` sin categoría). Nunca el de otra categoría.
 */
export function bannerDeCategoria(banners: readonly Banner[], slug: string): Banner | null {
  const propios = bannersDe(banners, 'category');
  return propios.find((b) => b.category_slug === slug) ?? propios.find((b) => !b.category_slug) ?? null;
}
