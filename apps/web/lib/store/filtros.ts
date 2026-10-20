/**
 * Estado del listado ↔ URL (§7.1–7.3) y cursor opaco. Puro y sin dependencias para poder probarlo.
 * Parámetros de URL: `genero`, `marca` (coma), `familia` (coma), `concentracion`, `categoria`,
 * `disponible=1`, `precio_min`, `precio_max`, `orden`, `q`, `page`.
 */
import type { CursorRpc, FiltrosCatalogo, OrdenCatalogo } from './types';

export const TAMANO_LOTE = 25;

const ORDENES_LISTADO: readonly OrdenCatalogo[] = ['featured', 'sales', 'newest', 'price_asc', 'price_desc', 'discount'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface EstadoListado {
  q: string;
  filtros: FiltrosCatalogo;
  orden: OrdenCatalogo;
  /** Página de respaldo para buscadores (`?page=N`). 1 = primera. */
  pagina: number;
}

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;

function leer(entrada: Entrada, clave: string): string | undefined {
  if (entrada instanceof URLSearchParams) return entrada.get(clave) ?? undefined;
  const v = entrada[clave];
  return Array.isArray(v) ? v[0] : v;
}

function slug(v: string | undefined): string | undefined {
  const t = v?.trim().toLowerCase();
  return t && t.length <= 80 && SLUG.test(t) ? t : undefined;
}

function slugs(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const lista = [...new Set(v.split(',').map((s) => slug(s)).filter((s): s is string => !!s))].slice(0, 20);
  return lista.length ? lista : undefined;
}

function monto(v: string | undefined): number | undefined {
  if (!v || !/^\d{1,12}$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function ordenValido(v: string | undefined, hayBusqueda: boolean): OrdenCatalogo {
  if (v === 'relevance') return hayBusqueda ? 'relevance' : 'featured';
  if ((ORDENES_LISTADO as readonly string[]).includes(v ?? '')) return v as OrdenCatalogo;
  return hayBusqueda ? 'relevance' : 'featured';
}

export function parsearEstado(entrada: Entrada): EstadoListado {
  const q = (leer(entrada, 'q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const filtros: FiltrosCatalogo = {};
  const gender = slug(leer(entrada, 'genero'));
  if (gender) filtros.gender = gender;
  const brands = slugs(leer(entrada, 'marca'));
  if (brands) filtros.brands = brands;
  const families = slugs(leer(entrada, 'familia'));
  if (families) filtros.families = families;
  const concentration = slug(leer(entrada, 'concentracion'));
  if (concentration) filtros.concentration = concentration;
  const category = slug(leer(entrada, 'categoria'));
  if (category) filtros.category = category;
  const collection = slug(leer(entrada, 'coleccion'));
  if (collection) filtros.collection = collection;
  if (leer(entrada, 'disponible') === '1') filtros.availability = 'in_stock';
  const pmin = monto(leer(entrada, 'precio_min'));
  const pmax = monto(leer(entrada, 'precio_max'));
  if (pmin !== undefined) filtros.price_min = pmin;
  if (pmax !== undefined) filtros.price_max = pmax;
  if (pmin !== undefined && pmax !== undefined && pmin > pmax) {
    filtros.price_min = pmax;
    filtros.price_max = pmin;
  }
  const pagina = Math.min(Math.max(Number(leer(entrada, 'page')) || 1, 1), 400);
  return { q, filtros, orden: ordenValido(leer(entrada, 'orden'), q.length > 0), pagina };
}

/** Serializa el estado; omite lo que vale lo mismo que el valor por defecto. */
export function aParametros(e: Partial<EstadoListado>): URLSearchParams {
  const p = new URLSearchParams();
  const f = e.filtros ?? {};
  if (e.q) p.set('q', e.q);
  if (f.gender) p.set('genero', f.gender);
  if (f.brands?.length) p.set('marca', f.brands.join(','));
  if (f.families?.length) p.set('familia', f.families.join(','));
  if (f.concentration) p.set('concentracion', f.concentration);
  if (f.category) p.set('categoria', f.category);
  if (f.collection) p.set('coleccion', f.collection);
  if (f.availability) p.set('disponible', '1');
  if (f.price_min !== undefined) p.set('precio_min', String(f.price_min));
  if (f.price_max !== undefined) p.set('precio_max', String(f.price_max));
  const porDefecto: OrdenCatalogo = e.q ? 'relevance' : 'featured';
  if (e.orden && e.orden !== porDefecto) p.set('orden', e.orden);
  if (e.pagina && e.pagina > 1) p.set('page', String(e.pagina));
  return p;
}

/** Filtros con la forma que espera `catalog_page` (`p_filters`). */
export function aFiltrosRpc(f: FiltrosCatalogo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.gender) out.gender = f.gender;
  if (f.brands?.length) out.brands = f.brands;
  if (f.families?.length) out.families = f.families;
  if (f.concentration) out.concentration = f.concentration;
  if (f.category) out.category = f.category;
  if (f.collection) out.collection = f.collection;
  if (f.availability) out.availability = f.availability;
  if (f.price_min !== undefined) out.price_min = f.price_min;
  if (f.price_max !== undefined) out.price_max = f.price_max;
  return out;
}

/** Cuenta cuántos filtros hay activos (sin contar orden ni búsqueda). */
export function contarFiltros(f: FiltrosCatalogo): number {
  return (
    (f.gender ? 1 : 0) +
    (f.brands?.length ?? 0) +
    (f.families?.length ?? 0) +
    (f.concentration ? 1 : 0) +
    (f.category ? 1 : 0) +
    (f.collection ? 1 : 0) +
    (f.availability ? 1 : 0) +
    (f.price_min !== undefined || f.price_max !== undefined ? 1 : 0)
  );
}

// --- Cursor opaco (base64url del JSON del RPC) ---------------------------------------------------------

function aBase64Url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function codificarCursor(c: CursorRpc | null | undefined): string | null {
  return c ? aBase64Url(JSON.stringify(c)) : null;
}

/** Devuelve `null` si el texto no es un cursor bien formado (el endpoint responde 400). */
export function decodificarCursor(s: string | null | undefined): CursorRpc | null {
  if (!s || s.length > 512 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const obj: unknown = JSON.parse(deBase64Url(s));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const c = obj as Record<string, unknown>;
    if (typeof c.o !== 'string' || typeof c.id !== 'string' || typeof c.v !== 'string') return null;
    if (c.s !== 0 && c.s !== 1) return null;
    return c;
  } catch {
    return null;
  }
}
