import type { Banner } from './types';

/**
 * `link_url` del banner tal como lo guarda el panel (D-045): ruta interna (`/co/perfume/{slug}?variante={sku}`,
 * `/co/categoria/{slug}`) o https. Se sigue sin reescribir; lo demás (vacío, `//host`, `javascript:`, http) se descarta.
 */
export function enlaceBanner(url: string | null | undefined): string | null {
  const t = typeof url === 'string' ? url.trim() : '';
  if (!t) return null;
  if (t.startsWith('/') && !t.startsWith('//') && !t.includes('\\')) return t;
  return /^https:\/\/[^\s]+$/i.test(t) ? t : null;
}

/** Vigente en `ahora`: ya empezó y no ha terminado (sin fechas = siempre). */
export function bannerVigente(b: { starts_at?: string | null; ends_at?: string | null }, ahora: Date): boolean {
  const t = ahora.getTime();
  if (b.starts_at && new Date(b.starts_at).getTime() > t) return false;
  if (b.ends_at && new Date(b.ends_at).getTime() <= t) return false;
  return true;
}

export const bannersDe = (banners: readonly Banner[], ubicacion: Banner['placement']): Banner[] => banners.filter((b) => b.placement === ubicacion);
