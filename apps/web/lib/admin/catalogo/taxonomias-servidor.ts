import 'server-only';
/** Lectura y escritura de marcas, familias, géneros y concentraciones (servicio, sin RLS). */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import {
  diffCampos,
  escaparBusqueda,
  rangoPagina,
  type ParametrosLista,
  type ResultadoAccion,
} from '../crud/comun';
import { invalidarCatalogo, traducirErrorBd } from '../crud/servidor';
import { columnasEscritura, type DatosTaxonomia, type DefTaxonomia } from './taxonomias';

export type Cliente = ReturnType<typeof crearClienteServicio>;

export type FilaTaxonomia = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  image_id?: string | null;
  sort_order?: number;
  updated_at: string;
};

const UNICOS = { slug: 'Ese identificador de URL ya está en uso.' };

export async function listarTaxonomia(
  cliente: Cliente,
  def: DefTaxonomia,
  { q, pagina }: ParametrosLista,
): Promise<{ filas: FilaTaxonomia[]; total: number }> {
  const [desde, hasta] = rangoPagina(pagina);
  let consulta = cliente
    .from(def.tabla)
    .select('*', { count: 'exact' })
    .order(def.tieneOrden ? 'sort_order' : 'name', { ascending: true })
    .order('name', { ascending: true })
    .range(desde, hasta);
  if (q) consulta = consulta.ilike('name', `%${escaparBusqueda(q)}%`);
  const { data, error, count } = await consulta;
  if (error) throw new Error(`No se pudo listar ${def.plural}: ${error.message}`);
  return { filas: (data ?? []) as FilaTaxonomia[], total: count ?? 0 };
}

export async function obtenerTaxonomia(
  cliente: Cliente,
  def: DefTaxonomia,
  id: string,
): Promise<(FilaTaxonomia & { imagen?: { ruta: string; alt: string } | null }) | null> {
  const { data, error } = await cliente.from(def.tabla).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer ${def.singular}: ${error.message}`);
  if (!data) return null;
  const fila = data as FilaTaxonomia;
  if (!fila.image_id) return fila;
  const { data: media } = await cliente
    .from('media')
    .select('variants, alt')
    .eq('id', fila.image_id)
    .maybeSingle();
  const ruta = (media?.variants as Record<string, string> | undefined)?.['400'];
  return { ...fila, imagen: ruta ? { ruta, alt: media?.alt ?? '' } : null };
}

export async function guardarTaxonomiaBd(args: {
  cliente: Cliente;
  def: DefTaxonomia;
  datos: DatosTaxonomia;
  actor: string;
  ip: string | null;
}): Promise<ResultadoAccion> {
  const { cliente, def, datos, actor, ip } = args;
  const fila = columnasEscritura(def, datos);

  if (datos.id) {
    const { data: antes } = await cliente.from(def.tabla).select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: `Esa ${def.singular} ya no existe.` };
    const { error } = await cliente.from(def.tabla).update(fila).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error, UNICOS) };
    await auditarCambio({
      actor,
      accion: `${def.tabla}.actualizado`,
      entidad: def.tabla,
      entidadId: datos.id,
      diff: diffCampos(antes as Record<string, unknown>, fila),
      ip,
    });
    invalidarCatalogo();
    return { ok: true, id: datos.id };
  }

  const { data, error } = await cliente.from(def.tabla).insert(fila).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error, UNICOS) };
  await auditarCambio({
    actor,
    accion: `${def.tabla}.creado`,
    entidad: def.tabla,
    entidadId: data.id,
    diff: { despues: fila },
    ip,
  });
  invalidarCatalogo();
  return { ok: true, id: data.id };
}

/** Elimina solo si ningún producto la usa (si no, el producto quedaría sin ella en silencio). */
export async function eliminarTaxonomiaBd(args: {
  cliente: Cliente;
  def: DefTaxonomia;
  id: string;
  actor: string;
  ip: string | null;
}): Promise<ResultadoAccion> {
  const { cliente, def, id, actor, ip } = args;
  const { count, error: errUso } = await cliente
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq(def.columnaProducto, id);
  if (errUso) return { ok: false, mensaje: 'No se pudo verificar si está en uso.' };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      mensaje: `No se puede eliminar: ${count} producto(s) la usan. Cámbialos a otra opción primero.`,
    };
  }
  const { data: antes } = await cliente.from(def.tabla).select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { error } = await cliente.from(def.tabla).delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: `${def.tabla}.eliminado`,
    entidad: def.tabla,
    entidadId: id,
    diff: { antes },
    ip,
  });
  invalidarCatalogo();
  return { ok: true };
}
