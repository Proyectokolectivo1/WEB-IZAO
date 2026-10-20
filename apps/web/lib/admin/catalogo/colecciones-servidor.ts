import 'server-only';
/** Colecciones (manuales y de regla) y destacados por país (servicio, sin RLS). */
import { auditarCambio } from '@/lib/admin/auditoria';
import { diffCampos, escaparBusqueda, type ResultadoAccion } from '../crud/comun';
import { invalidarCatalogo, traducirErrorBd, type Pais } from '../crud/servidor';
import { columnasColeccion, moverEnLista, renumerar, type DatosColeccion } from './colecciones';
import type { Cliente } from './taxonomias-servidor';

export type FilaColeccion = {
  id: string;
  country_code: Pais;
  name: string;
  slug: string;
  type: 'manual' | 'rule';
  rule: unknown;
  sort_order: number;
  show_in_home_tabs: boolean;
  is_active: boolean;
};

export type ItemColeccion = { product_id: string; sort_order: number; name: string; slug: string; status: string };
export type ProductoBusqueda = { id: string; name: string; slug: string; status: string };

type Ctx = { cliente: Cliente; actor: string; ip: string | null };

const UNICOS = { slug: 'Ya hay una colección con ese identificador de URL en este país.' };
const COLUMNAS = 'id, country_code, name, slug, type, rule, sort_order, show_in_home_tabs, is_active';

export async function listarColecciones(cliente: Cliente, pais: Pais): Promise<FilaColeccion[]> {
  const { data, error } = await cliente
    .from('collections')
    .select(COLUMNAS)
    .eq('country_code', pais)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`No se pudo listar colecciones: ${error.message}`);
  return (data ?? []) as FilaColeccion[];
}

export async function obtenerColeccion(
  cliente: Cliente,
  id: string,
): Promise<{ coleccion: FilaColeccion; items: ItemColeccion[] } | null> {
  const { data, error } = await cliente.from('collections').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la colección: ${error.message}`);
  if (!data) return null;
  const items = await cliente
    .from('collection_items')
    .select('product_id, sort_order, products(name, slug, status)')
    .eq('collection_id', id)
    .order('sort_order', { ascending: true });
  type Fila = { product_id: string; sort_order: number; products: { name: string; slug: string; status: string } | null };
  return {
    coleccion: data as FilaColeccion,
    items: ((items.data ?? []) as unknown as Fila[]).map((i) => ({
      product_id: i.product_id,
      sort_order: i.sort_order,
      name: i.products?.name ?? '(producto eliminado)',
      slug: i.products?.slug ?? '',
      status: i.products?.status ?? '',
    })),
  };
}

export async function buscarProductos(cliente: Cliente, q: string, limite = 10): Promise<ProductoBusqueda[]> {
  if (!q.trim()) return [];
  const { data } = await cliente
    .from('products')
    .select('id, name, slug, status')
    .neq('status', 'archived')
    .ilike('name', `%${escaparBusqueda(q.trim())}%`)
    .order('name', { ascending: true })
    .limit(limite);
  return (data ?? []) as ProductoBusqueda[];
}

export async function guardarColeccionBd(args: Ctx & { datos: DatosColeccion }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const fila = columnasColeccion(datos);
  if (datos.id) {
    const { data: antes } = await cliente.from('collections').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Esa colección ya no existe.' };
    const { error } = await cliente.from('collections').update(fila).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error, UNICOS) };
    await auditarCambio({
      actor,
      accion: 'collections.actualizado',
      entidad: 'collections',
      entidadId: datos.id,
      diff: diffCampos(antes as Record<string, unknown>, fila),
      ip,
    });
    invalidarCatalogo([datos.country_code, (antes as FilaColeccion).country_code]);
    return { ok: true, id: datos.id };
  }
  const { data, error } = await cliente.from('collections').insert(fila).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error, UNICOS) };
  await auditarCambio({ actor, accion: 'collections.creado', entidad: 'collections', entidadId: data.id, diff: { despues: fila }, ip });
  invalidarCatalogo([datos.country_code]);
  return { ok: true, id: data.id as string };
}

export async function eliminarColeccionBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('collections').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { error } = await cliente.from('collections').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'collections.eliminado', entidad: 'collections', entidadId: id, diff: { antes }, ip });
  invalidarCatalogo([(antes as FilaColeccion).country_code]);
  return { ok: true };
}

async function paisDe(cliente: Cliente, coleccionId: string): Promise<{ pais: Pais; tipo: string } | null> {
  const { data } = await cliente.from('collections').select('country_code, type').eq('id', coleccionId).maybeSingle();
  return data ? { pais: data.country_code as Pais, tipo: data.type as string } : null;
}

async function idsOrdenados(cliente: Cliente, coleccionId: string): Promise<string[]> {
  const { data } = await cliente
    .from('collection_items')
    .select('product_id')
    .eq('collection_id', coleccionId)
    .order('sort_order', { ascending: true });
  return (data ?? []).map((r) => r.product_id as string);
}

async function escribirOrden(cliente: Cliente, coleccionId: string, ids: readonly string[]) {
  const filas = renumerar(ids).map(({ valor, posicion }) => ({
    collection_id: coleccionId,
    product_id: valor,
    sort_order: posicion,
  }));
  return cliente.from('collection_items').upsert(filas, { onConflict: 'collection_id,product_id' });
}

export async function agregarItemBd(args: Ctx & { coleccionId: string; productId: string }): Promise<ResultadoAccion> {
  const { cliente, coleccionId, productId, actor, ip } = args;
  const col = await paisDe(cliente, coleccionId);
  if (!col) return { ok: false, mensaje: 'Esa colección ya no existe.' };
  if (col.tipo !== 'manual') return { ok: false, mensaje: 'Solo las colecciones manuales llevan productos elegidos a mano.' };
  const ids = await idsOrdenados(cliente, coleccionId);
  if (ids.includes(productId)) return { ok: true };
  const { error } = await escribirOrden(cliente, coleccionId, [...ids, productId]);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'collections.item_agregado', entidad: 'collections', entidadId: coleccionId, diff: { despues: { product_id: productId } }, ip });
  invalidarCatalogo([col.pais]);
  return { ok: true };
}

export async function quitarItemBd(args: Ctx & { coleccionId: string; productId: string }): Promise<ResultadoAccion> {
  const { cliente, coleccionId, productId, actor, ip } = args;
  const col = await paisDe(cliente, coleccionId);
  if (!col) return { ok: false, mensaje: 'Esa colección ya no existe.' };
  const { error } = await cliente.from('collection_items').delete().eq('collection_id', coleccionId).eq('product_id', productId);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  const resto = (await idsOrdenados(cliente, coleccionId)).filter((i) => i !== productId);
  if (resto.length > 0) await escribirOrden(cliente, coleccionId, resto);
  await auditarCambio({ actor, accion: 'collections.item_quitado', entidad: 'collections', entidadId: coleccionId, diff: { antes: { product_id: productId } }, ip });
  invalidarCatalogo([col.pais]);
  return { ok: true };
}

export async function moverItemBd(
  args: Ctx & { coleccionId: string; productId: string; direccion: 'arriba' | 'abajo' },
): Promise<ResultadoAccion> {
  const { cliente, coleccionId, productId, direccion, actor, ip } = args;
  const col = await paisDe(cliente, coleccionId);
  if (!col) return { ok: false, mensaje: 'Esa colección ya no existe.' };
  const ids = await idsOrdenados(cliente, coleccionId);
  const nuevo = moverEnLista(ids, productId, direccion);
  const { error } = await escribirOrden(cliente, coleccionId, nuevo);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'collections.item_movido', entidad: 'collections', entidadId: coleccionId, diff: { despues: { product_id: productId, direccion } }, ip });
  invalidarCatalogo([col.pais]);
  return { ok: true };
}

// ---------------------------------------------------------------- Destacados

export type Destacado = { product_id: string; featured_rank: number | null; name: string; is_visible: boolean };

export async function listarDestacados(cliente: Cliente, pais: Pais): Promise<Destacado[]> {
  const { data, error } = await cliente
    .from('product_countries')
    .select('product_id, featured_rank, is_visible, products(name)')
    .eq('country_code', pais)
    .eq('is_featured', true)
    .order('featured_rank', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`No se pudo listar destacados: ${error.message}`);
  type Fila = { product_id: string; featured_rank: number | null; is_visible: boolean; products: { name: string } | null };
  return ((Array.isArray(data) ? data : []) as unknown as Fila[]).map((f) => ({
    product_id: f.product_id,
    featured_rank: f.featured_rank,
    is_visible: f.is_visible,
    name: f.products?.name ?? '(producto eliminado)',
  }));
}

async function escribirRangos(cliente: Cliente, pais: Pais, ids: readonly string[]) {
  for (const { valor, posicion } of renumerar(ids)) {
    const { error } = await cliente
      .from('product_countries')
      .update({ is_featured: true, featured_rank: posicion })
      .eq('product_id', valor)
      .eq('country_code', pais);
    if (error) return error;
  }
  return null;
}

export async function destacarBd(args: Ctx & { productId: string; pais: Pais }): Promise<ResultadoAccion> {
  const { cliente, productId, pais, actor, ip } = args;
  const { data: fila } = await cliente
    .from('product_countries')
    .select('product_id')
    .eq('product_id', productId)
    .eq('country_code', pais)
    .maybeSingle();
  if (!fila) return { ok: false, mensaje: 'El producto aún no está configurado para ese país: guárdalo primero en Productos.' };
  const actuales = (await listarDestacados(cliente, pais)).map((d) => d.product_id).filter((i) => i !== productId);
  const error = await escribirRangos(cliente, pais, [...actuales, productId]);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'destacados.agregado', entidad: 'product_countries', entidadId: productId, diff: { despues: { country_code: pais, is_featured: true } }, ip });
  invalidarCatalogo([pais]);
  return { ok: true };
}

export async function quitarDestacadoBd(args: Ctx & { productId: string; pais: Pais }): Promise<ResultadoAccion> {
  const { cliente, productId, pais, actor, ip } = args;
  const { error } = await cliente
    .from('product_countries')
    .update({ is_featured: false, featured_rank: null })
    .eq('product_id', productId)
    .eq('country_code', pais);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  const resto = (await listarDestacados(cliente, pais)).map((d) => d.product_id);
  const errRangos = await escribirRangos(cliente, pais, resto);
  if (errRangos) return { ok: false, ...traducirErrorBd(errRangos) };
  await auditarCambio({ actor, accion: 'destacados.quitado', entidad: 'product_countries', entidadId: productId, diff: { antes: { country_code: pais, is_featured: true } }, ip });
  invalidarCatalogo([pais]);
  return { ok: true };
}

export async function moverDestacadoBd(
  args: Ctx & { productId: string; pais: Pais; direccion: 'arriba' | 'abajo' },
): Promise<ResultadoAccion> {
  const { cliente, productId, pais, direccion, actor, ip } = args;
  const ids = (await listarDestacados(cliente, pais)).map((d) => d.product_id);
  const error = await escribirRangos(cliente, pais, moverEnLista(ids, productId, direccion));
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'destacados.movido', entidad: 'product_countries', entidadId: productId, diff: { despues: { country_code: pais, direccion } }, ip });
  invalidarCatalogo([pais]);
  return { ok: true };
}
