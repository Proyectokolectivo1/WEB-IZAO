import 'server-only';
/**
 * Gastos (§22) con el cliente de servicio: lista con filtros y totales por categoría, alta/edición/borrado de gastos
 * manuales y categorías. Toda escritura se audita con su diff. Los gastos de Meta Ads y de la billetera de MasterShop
 * (`source` distinto de `manual`) son de solo lectura: los reescribe su sincronización.
 */
import type { FechaIso } from '@izao/core/metrics';
import { fromDbAmount } from '@izao/core/money';
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, rangoPagina, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import { MONEDA_PAIS } from '../pagos/ajustes';
import {
  PATRON_SLUG_CATEGORIA,
  slugDeCategoria,
  type DatosCategoriaGasto,
  type DatosGasto,
  type FiltrosGasto,
  type OrigenGasto,
} from './gastos';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Monto = number | string | bigint;
type Pais = 'CO' | 'EC';

export type FilaGasto = {
  id: string;
  country_code: Pais;
  category_id: string;
  date: string;
  amount: Monto;
  currency_code: 'COP' | 'USD';
  description: string | null;
  source: OrigenGasto;
  external_ref: string | null;
  attachment_media_id: string | null;
  expense_categories: { name: string; slug: string } | null;
};

export type FilaCategoriaGasto = { id: string; slug: string; name: string; is_system: boolean };

const COLUMNAS = 'id, country_code, category_id, date, amount, currency_code, description, source, external_ref, attachment_media_id, expense_categories(name, slug)';
const PAGINA_TOTALES = 1000;
const MAX_PAGINAS_TOTALES = 30;

const unico = <T>(v: T[] | T | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function normalizar(f: FilaGasto & { expense_categories: unknown }): FilaGasto {
  return { ...f, expense_categories: unico(f.expense_categories as FilaGasto['expense_categories'] | FilaGasto['expense_categories'][]) };
}

export type RangoGasto = { desde: FechaIso; hasta: FechaIso };

function aplicarFiltros<Q extends { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q }>(
  q: Q,
  pais: Pais,
  rango: RangoGasto,
  f: Pick<FiltrosGasto, 'categoria' | 'origen'>,
): Q {
  let r = q.eq('country_code', pais).gte('date', rango.desde).lte('date', rango.hasta);
  if (f.categoria) r = r.eq('category_id', f.categoria);
  if (f.origen) r = r.eq('source', f.origen);
  return r;
}

export async function listarGastos(
  cliente: Cliente,
  pais: Pais,
  rango: RangoGasto,
  f: FiltrosGasto,
): Promise<{ filas: FilaGasto[]; total: number }> {
  const base = cliente.from('expenses').select(COLUMNAS, { count: 'exact' });
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await aplicarFiltros(base, pais, rango, f)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar los gastos: ${error.message}`);
  return { filas: ((data ?? []) as unknown as FilaGasto[]).map(normalizar), total: count ?? 0 };
}

/** Todos los gastos del rango (para el Excel), leídos de a 1 000 filas con tope de 30 000. */
export async function todosLosGastos(
  cliente: Cliente,
  pais: Pais,
  rango: RangoGasto,
  f: Pick<FiltrosGasto, 'categoria' | 'origen'>,
): Promise<{ filas: FilaGasto[]; truncado: boolean }> {
  const filas: FilaGasto[] = [];
  for (let n = 0; n < MAX_PAGINAS_TOTALES; n += 1) {
    const base = cliente.from('expenses').select(COLUMNAS);
    const { data, error } = await aplicarFiltros(base, pais, rango, f)
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .range(n * PAGINA_TOTALES, n * PAGINA_TOTALES + PAGINA_TOTALES - 1);
    if (error) throw new Error(`No se pudieron leer los gastos: ${error.message}`);
    const lote = ((data ?? []) as unknown as FilaGasto[]).map(normalizar);
    filas.push(...lote);
    if (lote.length < PAGINA_TOTALES) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

export type TotalCategoria = { categoriaId: string; nombre: string; slug: string; total: bigint };

/** Suma por categoría de todo el rango (no solo de la página). El tope avisa si el rango es excepcionalmente grande. */
export async function totalesPorCategoria(
  cliente: Cliente,
  pais: Pais,
  rango: RangoGasto,
  f: Pick<FiltrosGasto, 'categoria' | 'origen'>,
): Promise<{ filas: TotalCategoria[]; total: bigint; truncado: boolean }> {
  const porCategoria = new Map<string, TotalCategoria>();
  let total = 0n;
  let truncado = true;
  for (let n = 0; n < MAX_PAGINAS_TOTALES; n += 1) {
    const base = cliente.from('expenses').select('category_id, amount, expense_categories(name, slug)');
    const { data, error } = await aplicarFiltros(base, pais, rango, f)
      .order('id', { ascending: true })
      .range(n * PAGINA_TOTALES, n * PAGINA_TOTALES + PAGINA_TOTALES - 1);
    if (error) throw new Error(`No se pudieron sumar los gastos: ${error.message}`);
    const lote = (data ?? []) as unknown as { category_id: string; amount: Monto; expense_categories: { name: string; slug: string } | { name: string; slug: string }[] | null }[];
    for (const g of lote) {
      const monto = fromDbAmount(g.amount);
      const cat = unico(g.expense_categories);
      const previo = porCategoria.get(g.category_id) ?? { categoriaId: g.category_id, nombre: cat?.name ?? '(sin categoría)', slug: cat?.slug ?? '', total: 0n };
      previo.total += monto;
      porCategoria.set(g.category_id, previo);
      total += monto;
    }
    if (lote.length < PAGINA_TOTALES) {
      truncado = false;
      break;
    }
  }
  const filas = [...porCategoria.values()].sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1));
  return { filas, total, truncado };
}

export async function obtenerGasto(cliente: Cliente, id: string): Promise<FilaGasto | null> {
  const { data, error } = await cliente.from('expenses').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el gasto: ${error.message}`);
  return data ? normalizar(data as unknown as FilaGasto) : null;
}

export async function listarCategoriasGasto(cliente: Cliente): Promise<FilaCategoriaGasto[]> {
  const { data, error } = await cliente.from('expense_categories').select('id, slug, name, is_system').order('name', { ascending: true });
  if (error) throw new Error(`No se pudieron listar las categorías: ${error.message}`);
  return (data ?? []) as unknown as FilaCategoriaGasto[];
}

// ── Gastos ───────────────────────────────────────────────────────────────────────────────────────

function columnas(d: DatosGasto): Record<string, unknown> {
  return {
    country_code: d.country_code,
    category_id: d.category_id,
    date: d.date,
    amount: d.amount.toString(),
    currency_code: MONEDA_PAIS[d.country_code],
    description: d.description,
    attachment_media_id: d.attachment_media_id,
  };
}

export async function guardarGastoBd(args: Ctx & { datos: DatosGasto }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const fila = columnas(datos);
  const { data: categoria } = await cliente.from('expense_categories').select('id').eq('id', datos.category_id).maybeSingle();
  if (!categoria) return { ok: false, mensaje: 'Esa categoría ya no existe.', errores: { category_id: 'Elige una categoría.' } };
  if (datos.attachment_media_id) {
    // Solo imágenes subidas como comprobante de gasto: no se adjunta cualquier archivo del sitio.
    const { data: media } = await cliente.from('media').select('id').eq('id', datos.attachment_media_id).eq('kind', 'expense').maybeSingle();
    if (!media) return { ok: false, mensaje: 'Ese comprobante no es válido. Súbelo de nuevo.', errores: { attachment_media_id: 'Sube el comprobante de nuevo.' } };
  }

  if (datos.id) {
    const { data: antes } = await cliente.from('expenses').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Ese gasto ya no existe.' };
    const previo = antes as Record<string, unknown>;
    if (previo.source !== 'manual') {
      return { ok: false, mensaje: 'Este gasto lo trae una sincronización automática: no se edita a mano.' };
    }
    const { error } = await cliente.from('expenses').update(fila).eq('id', datos.id).eq('source', 'manual');
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({ actor, accion: 'gastos.actualizado', entidad: 'expenses', entidadId: datos.id, diff: diffCampos(previo, fila), ip });
    return { ok: true, id: datos.id };
  }
  const { data, error } = await cliente
    .from('expenses')
    .insert({ ...fila, source: 'manual', created_by: actor })
    .select('id')
    .single();
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'gastos.creado', entidad: 'expenses', entidadId: data.id, diff: { despues: fila }, ip });
  return { ok: true, id: data.id as string };
}

/** Borra un gasto manual; el registro completo queda en la auditoría. */
export async function eliminarGastoBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('expenses').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  if ((antes as { source: string }).source !== 'manual') {
    return { ok: false, mensaje: 'Este gasto lo trae una sincronización automática: no se borra a mano.' };
  }
  const { error } = await cliente.from('expenses').delete().eq('id', id).eq('source', 'manual');
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'gastos.eliminado', entidad: 'expenses', entidadId: id, diff: { antes }, ip });
  return { ok: true };
}

// ── Categorías ───────────────────────────────────────────────────────────────────────────────────

/** Crea (slug derivado del nombre, inmutable) o renombra una categoría. */
export async function guardarCategoriaGastoBd(args: Ctx & { datos: DatosCategoriaGasto }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  if (datos.id) {
    const { data: antes } = await cliente.from('expense_categories').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Esa categoría ya no existe.' };
    const fila = { name: datos.name };
    const { error } = await cliente.from('expense_categories').update(fila).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({ actor, accion: 'gastos.categoria_actualizada', entidad: 'expense_categories', entidadId: datos.id, diff: diffCampos(antes as Record<string, unknown>, fila), ip });
    return { ok: true, id: datos.id };
  }
  const slug = slugDeCategoria(datos.name, datos.es_pauta);
  if (!PATRON_SLUG_CATEGORIA.test(slug)) {
    return { ok: false, mensaje: 'Usa un nombre con letras o números.', errores: { name: 'Usa un nombre con letras o números.' } };
  }
  const fila = { slug, name: datos.name, is_system: false };
  const { data, error } = await cliente.from('expense_categories').insert(fila).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error, { slug: 'Ya existe una categoría con ese nombre.' }) };
  await auditarCambio({ actor, accion: 'gastos.categoria_creada', entidad: 'expense_categories', entidadId: data.id, diff: { despues: fila }, ip });
  return { ok: true, id: data.id as string };
}

/** Las del sistema y las que ya tienen gastos no se borran (se perdería el desglose histórico). */
export async function eliminarCategoriaGastoBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('expense_categories').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  if ((antes as { is_system: boolean }).is_system) return { ok: false, mensaje: 'Es una categoría del sistema: no se puede eliminar.' };
  const { count } = await cliente.from('expenses').select('id', { count: 'exact', head: true }).eq('category_id', id);
  if ((count ?? 0) > 0) return { ok: false, mensaje: 'Esta categoría ya tiene gastos: no se puede eliminar.' };
  const { error } = await cliente.from('expense_categories').delete().eq('id', id).eq('is_system', false);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'gastos.categoria_eliminada', entidad: 'expense_categories', entidadId: id, diff: { antes }, ip });
  return { ok: true };
}

/** Comprobante de un gasto (miniatura), para mostrarlo en el formulario. */
export async function comprobanteDeGasto(cliente: Cliente, mediaId: string | null): Promise<{ id: string; ruta: string; alt: string } | null> {
  if (!mediaId) return null;
  const { data } = await cliente.from('media').select('id, variants, alt').eq('id', mediaId).maybeSingle();
  if (!data) return null;
  const m = data as { id: string; variants: Record<string, string> | null; alt: string | null };
  const v = m.variants ?? {};
  return { id: m.id, ruta: v['400'] ?? Object.values(v)[0] ?? '', alt: m.alt ?? '' };
}
