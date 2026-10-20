import { TAMANO_LOTE, codificarCursor } from './filtros';
import { combinarFijos, saltosParaPagina, type ConsultaListado, type LoteListado } from './lote';
import type { TiendaRepo } from './repo';
import type { CodigoPais, FiltrosCatalogo } from './types';

export interface ListadoInicial extends LoteListado {
  precioMin: number | null;
  precioMax: number | null;
  /** `true` si `?page=N` pide una página que no existe (más allá del final). */
  fueraDeRango: boolean;
}

/**
 * Primer lote del listado en el servidor (SEO y LCP). Con `?page=N` recorre los cursores de las páginas
 * anteriores (nunca OFFSET) y devuelve la página N, con su cursor para seguir cargando desde ahí.
 */
export async function cargarInicial(
  repo: Pick<TiendaRepo, 'catalogo'>,
  pais: CodigoPais,
  c: ConsultaListado,
  fijos: FiltrosCatalogo,
  pagina: number,
): Promise<ListadoInicial> {
  const filtros = combinarFijos(c.filtros, fijos);
  const base = { q: c.q || undefined, filtros, orden: c.orden };
  let cursor = null;
  for (const limite of saltosParaPagina(pagina)) {
    const salto = await repo.catalogo(pais, { ...base, cursor, limite });
    if (!salto.next_cursor) return { items: [], nextCursor: null, total: salto.total_estimado, precioMin: null, precioMax: null, fueraDeRango: true };
    cursor = salto.next_cursor;
  }
  const lote = await repo.catalogo(pais, { ...base, cursor, limite: TAMANO_LOTE, conTotal: true });
  return {
    items: lote.items,
    nextCursor: codificarCursor(lote.next_cursor),
    total: lote.total_estimado,
    precioMin: lote.precio_min,
    precioMax: lote.precio_max,
    fueraDeRango: pagina > 1 && lote.items.length === 0,
  };
}
