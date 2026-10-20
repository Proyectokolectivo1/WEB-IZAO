import { TIPOS_PAGINA, type PaginaListada, type TipoPagina } from './types';

/** `pages.kind` desconocido (una base más nueva que el código) se trata como página general. */
export function normalizarTipo(v: unknown): TipoPagina {
  return (TIPOS_PAGINA as readonly string[]).includes(String(v)) ? (v as TipoPagina) : 'general';
}

/** Orden del pie: primero las páginas con tipo (en este orden) y al final las generales, cada grupo por título. */
const ORDEN: Record<TipoPagina, number> = {
  quienes_somos: 0,
  envios: 1,
  devoluciones: 2,
  terminos: 3,
  tratamiento_datos: 4,
  general: 5,
};

export function ordenarPaginas<T extends PaginaListada>(paginas: readonly T[]): T[] {
  return [...paginas].sort((a, b) => ORDEN[a.kind] - ORDEN[b.kind] || a.title.localeCompare(b.title, 'es'));
}

/** La página publicada de un tipo (no `general`); si hubiera más de una, la primera por título. */
export function paginaDeTipo<T extends PaginaListada>(paginas: readonly T[], kind: Exclude<TipoPagina, 'general'>): T | null {
  return paginas.filter((p) => p.kind === kind).sort((a, b) => a.title.localeCompare(b.title, 'es'))[0] ?? null;
}
