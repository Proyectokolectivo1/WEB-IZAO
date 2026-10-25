import 'server-only';
/**
 * Home (§8.5, §24.1) con el cliente de servicio: lista, alta, edición, activación, orden y borrado de las secciones de
 * `home_sections` de un país. El reorden es un solo `upsert` (atómico). Toda escritura se audita e invalida el
 * contenido público del país (`content:{país}`), de donde la tienda lee el home.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd } from '../crud/servidor';
import {
  configDeSeccion,
  esTipoSeccion,
  moverSeccion,
  siguienteOrden,
  type DatosSeccion,
  type SeccionAdmin,
} from './home';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Pais = 'CO' | 'EC';

const COLUMNAS = 'id, country_code, type, config, sort_order, is_active';

function aSeccion(f: Record<string, unknown>): SeccionAdmin | null {
  if (!esTipoSeccion(f.type)) return null;
  return {
    id: String(f.id),
    country_code: f.country_code as Pais,
    type: f.type,
    config: (f.config && typeof f.config === 'object' ? f.config : {}) as Record<string, unknown>,
    sort_order: Number(f.sort_order),
    is_active: f.is_active === true,
  };
}

export async function listarSecciones(cliente: Cliente, pais: Pais): Promise<SeccionAdmin[]> {
  const { data, error } = await cliente.from('home_sections').select(COLUMNAS).eq('country_code', pais).order('sort_order', { ascending: true }).limit(100);
  if (error) throw new Error(`No se pudieron leer las secciones del home: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(aSeccion).filter((s): s is SeccionAdmin => s !== null);
}

export async function obtenerSeccion(cliente: Cliente, id: string): Promise<SeccionAdmin | null> {
  const { data, error } = await cliente.from('home_sections').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la sección: ${error.message}`);
  return data ? aSeccion(data as Record<string, unknown>) : null;
}

/** Crea (al final del orden) o edita una sección. El tipo y el país de una existente no cambian. */
export async function guardarSeccionBd(args: Ctx & { datos: DatosSeccion; pais: Pais }): Promise<ResultadoAccion> {
  const { cliente, datos, pais, actor, ip } = args;
  if (datos.id) {
    const antes = await obtenerSeccion(cliente, datos.id);
    if (!antes) return { ok: false, mensaje: 'Esa sección ya no existe.' };
    const fila = { config: configDeSeccion(antes.config, { ...datos, type: antes.type }), is_active: datos.is_active };
    const { error } = await cliente.from('home_sections').update(fila).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({
      actor,
      accion: 'home.seccion_actualizada',
      entidad: 'home_sections',
      entidadId: datos.id,
      diff: diffCampos({ config: antes.config, is_active: antes.is_active }, fila),
      ip,
    });
    invalidarContenido([antes.country_code]);
    return { ok: true, id: datos.id };
  }
  const existentes = await listarSecciones(cliente, pais);
  const fila = {
    country_code: pais,
    type: datos.type,
    config: configDeSeccion(null, datos),
    sort_order: siguienteOrden(existentes),
    is_active: datos.is_active,
  };
  const { data, error } = await cliente.from('home_sections').insert(fila).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'home.seccion_creada', entidad: 'home_sections', entidadId: data.id, diff: { despues: fila }, ip });
  invalidarContenido([pais]);
  return { ok: true, id: data.id as string };
}

/** Sube o baja una sección: renumera el orden del país en un solo `upsert`. */
export async function moverSeccionBd(args: Ctx & { id: string; sentido: 'arriba' | 'abajo' }): Promise<ResultadoAccion> {
  const { cliente, id, sentido, actor, ip } = args;
  const actual = await obtenerSeccion(cliente, id);
  if (!actual) return { ok: false, mensaje: 'Esa sección ya no existe.' };
  const todas = await listarSecciones(cliente, actual.country_code);
  const cambios = moverSeccion(todas, id, sentido);
  if (!cambios) return { ok: true, id }; // ya está en el borde
  const porId = new Map(todas.map((s) => [s.id, s]));
  const filas = cambios.map((c) => ({ ...porId.get(c.id)!, sort_order: c.sort_order }));
  const { error } = await cliente.from('home_sections').upsert(filas, { onConflict: 'id' });
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: 'home.orden_cambiado',
    entidad: 'home_sections',
    entidadId: id,
    diff: { pais: actual.country_code, sentido, orden: cambios },
    ip,
  });
  invalidarContenido([actual.country_code]);
  return { ok: true, id };
}

export async function alternarSeccionBd(args: Ctx & { id: string; activa: boolean }): Promise<ResultadoAccion> {
  const { cliente, id, activa, actor, ip } = args;
  const antes = await obtenerSeccion(cliente, id);
  if (!antes) return { ok: false, mensaje: 'Esa sección ya no existe.' };
  const { error } = await cliente.from('home_sections').update({ is_active: activa }).eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: activa ? 'home.seccion_activada' : 'home.seccion_desactivada', entidad: 'home_sections', entidadId: id, diff: { tipo: antes.type }, ip });
  invalidarContenido([antes.country_code]);
  return { ok: true, id };
}

export async function eliminarSeccionBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const antes = await obtenerSeccion(cliente, id);
  if (!antes) return { ok: true };
  const { error } = await cliente.from('home_sections').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'home.seccion_eliminada', entidad: 'home_sections', entidadId: id, diff: { antes }, ip });
  invalidarContenido([antes.country_code]);
  return { ok: true };
}
