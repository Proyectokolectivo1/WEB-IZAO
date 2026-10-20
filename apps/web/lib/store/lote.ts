/**
 * Lógica pura del listado con lote infinito (§7.1): URL de la API, fusión sin repetidos, filtros fijos de la
 * ruta, enlaces de respaldo `?page=N`, instantánea para restaurar al volver de la ficha y rango de precio.
 * Sin React ni red, para poder probarla.
 */
import { TAMANO_LOTE, aParametros, type EstadoListado } from './filtros';
import type { CodigoPais, FiltrosCatalogo, ItemCatalogo, OrdenCatalogo } from './types';

export interface ConsultaListado {
  q: string;
  filtros: FiltrosCatalogo;
  orden: OrdenCatalogo;
}

export interface LoteListado {
  items: ItemCatalogo[];
  nextCursor: string | null;
  total: number | null;
}

/** Quita de `f` los filtros que la ruta ya fija (p. ej. `/categoria/arabes`): no van en la URL ni como chip. */
export function quitarFijos(f: FiltrosCatalogo, fijos: FiltrosCatalogo): FiltrosCatalogo {
  const salida: FiltrosCatalogo = { ...f };
  for (const k of Object.keys(fijos) as (keyof FiltrosCatalogo)[]) delete salida[k];
  return salida;
}

/** Los filtros de la ruta mandan sobre los de la URL. */
export function combinarFijos(f: FiltrosCatalogo, fijos: FiltrosCatalogo): FiltrosCatalogo {
  return { ...f, ...fijos };
}

/** Parámetros de `GET /api/catalog` para una consulta (con los filtros fijos ya combinados). */
export function parametrosApi(pais: CodigoPais, c: ConsultaListado, fijos: FiltrosCatalogo, cursor?: string | null): URLSearchParams {
  const p = aParametros({ q: c.q, filtros: combinarFijos(c.filtros, fijos), orden: c.orden });
  const salida = new URLSearchParams({ country: pais });
  p.forEach((v, k) => salida.set(k, v));
  if (cursor) salida.set('cursor', cursor);
  return salida;
}

/** Une lotes conservando el orden y descartando repetidos por `product_id`. */
export function fusionar(actuales: readonly ItemCatalogo[], nuevos: readonly ItemCatalogo[]): ItemCatalogo[] {
  const vistos = new Set(actuales.map((i) => i.product_id));
  const salida = [...actuales];
  for (const i of nuevos) {
    if (vistos.has(i.product_id)) continue;
    vistos.add(i.product_id);
    salida.push(i);
  }
  return salida;
}

/** Ruta + parámetros visibles del listado (sin los filtros fijos). `pagina` solo para los enlaces de respaldo. */
export function hrefListado(base: string, c: Partial<EstadoListado>, fijos: FiltrosCatalogo, pagina?: number): string {
  const p = aParametros({ ...c, filtros: quitarFijos(c.filtros ?? {}, fijos), pagina });
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Para llegar a `?page=N` sin OFFSET se recorren los cursores: devuelve el tamaño de cada salto
 * (máximo 100 por llamada, el tope del RPC) hasta dejar el cursor justo antes de la página N.
 */
export function saltosParaPagina(pagina: number, lote = TAMANO_LOTE, maximo = 100): number[] {
  let faltan = Math.max(pagina - 1, 0) * lote;
  const saltos: number[] = [];
  while (faltan > 0) {
    const n = Math.min(faltan, maximo);
    saltos.push(n);
    faltan -= n;
  }
  return saltos;
}

// --- Instantánea para «volver desde la ficha» ---------------------------------------------------------------

export interface Instantanea extends LoteListado {
  v: 1;
  scrollY: number;
  guardado: number;
}

export const VIGENCIA_INSTANTANEA_MS = 30 * 60 * 1000;

export function serializarInstantanea(i: Omit<Instantanea, 'v'>): string {
  return JSON.stringify({ v: 1, ...i });
}

/** Devuelve `null` si el texto no es una instantánea vigente y bien formada. */
export function leerInstantanea(texto: string | null, ahora = Date.now()): Instantanea | null {
  if (!texto) return null;
  try {
    const o: unknown = JSON.parse(texto);
    if (!o || typeof o !== 'object') return null;
    const r = o as Record<string, unknown>;
    if (r.v !== 1 || !Array.isArray(r.items) || r.items.length === 0) return null;
    if (!r.items.every((i) => i && typeof i === 'object' && typeof (i as ItemCatalogo).product_id === 'string' && typeof (i as ItemCatalogo).slug === 'string')) return null;
    if (typeof r.guardado !== 'number' || ahora - r.guardado > VIGENCIA_INSTANTANEA_MS) return null;
    if (typeof r.scrollY !== 'number' || !Number.isFinite(r.scrollY) || r.scrollY < 0) return null;
    if (r.nextCursor !== null && typeof r.nextCursor !== 'string') return null;
    if (r.total !== null && typeof r.total !== 'number') return null;
    return r as unknown as Instantanea;
  } catch {
    return null;
  }
}

// --- Rango de precio -----------------------------------------------------------------------------------------

export interface RangoPrecio {
  min: number;
  max: number;
}

/** Ajusta el rango escogido a los límites reales y al paso; `null` en un extremo = sin filtro en ese lado. */
export function normalizarRango(
  valor: { min?: number; max?: number },
  limites: RangoPrecio,
  paso: number,
): { price_min?: number; price_max?: number } {
  const piso = Math.floor(limites.min / paso) * paso;
  const techo = Math.ceil(limites.max / paso) * paso;
  let min = valor.min === undefined ? piso : Math.min(Math.max(valor.min, piso), techo);
  let max = valor.max === undefined ? techo : Math.min(Math.max(valor.max, piso), techo);
  if (min > max) [min, max] = [max, min];
  const salida: { price_min?: number; price_max?: number } = {};
  if (min > piso) salida.price_min = min;
  if (max < techo) salida.price_max = max;
  return salida;
}

/** Extremos del control: el filtro vigente o, si no hay, los límites reales redondeados al paso. */
export function extremosControl(
  f: { price_min?: number; price_max?: number },
  limites: RangoPrecio,
  paso: number,
): { piso: number; techo: number; min: number; max: number } {
  const piso = Math.floor(limites.min / paso) * paso;
  const techo = Math.max(Math.ceil(limites.max / paso) * paso, piso + paso);
  return { piso, techo, min: Math.min(Math.max(f.price_min ?? piso, piso), techo), max: Math.min(Math.max(f.price_max ?? techo, piso), techo) };
}
