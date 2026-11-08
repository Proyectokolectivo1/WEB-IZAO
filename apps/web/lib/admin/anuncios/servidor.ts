import 'server-only';
/** Cinta superior por país: lectura, guardado, orden, activación, borrado y segundos de rotación (servicio, sin RLS). */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { moverEnLista } from '../catalogo/colecciones';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd, type Pais } from '../crud/servidor';
import type { DatosAnuncio, DatosRotacion } from './anuncios';

export type Cliente = ReturnType<typeof crearClienteServicio>;
type Ctx = { cliente: Cliente; actor: string; ip: string | null };

export type FilaAnuncio = { id: string; country_code: Pais; text: string; link_url: string | null; sort_order: number; is_active: boolean };

const PASO = 10;
/** Rotación de la semilla (§9.2) si el país aún no tiene fila en `country_settings`. */
export const ROTACION_DEFECTO = 4;

export async function listarAnuncios(cliente: Cliente, pais: Pais): Promise<FilaAnuncio[]> {
  const { data, error } = await cliente
    .from('announcements')
    .select('id, country_code, text, link_url, sort_order, is_active')
    .eq('country_code', pais)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudo listar la cinta superior: ${error.message}`);
  return (data ?? []) as unknown as FilaAnuncio[];
}

export async function leerRotacion(cliente: Cliente, pais: Pais): Promise<number> {
  const { data } = await cliente.from('country_settings').select('announcement_rotation_seconds').eq('country_code', pais).maybeSingle();
  return (data as { announcement_rotation_seconds: number } | null)?.announcement_rotation_seconds ?? ROTACION_DEFECTO;
}

async function siguienteOrden(cliente: Cliente, pais: Pais): Promise<number> {
  const { data } = await cliente.from('announcements').select('sort_order').eq('country_code', pais).order('sort_order', { ascending: false }).limit(1);
  return ((data as { sort_order: number }[] | null)?.[0]?.sort_order ?? 0) + PASO;
}

export async function guardarAnuncioBd(args: Ctx & { datos: DatosAnuncio }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  if (datos.id) {
    const { data: antes } = await cliente.from('announcements').select('*').eq('id', datos.id).maybeSingle();
    if (!antes) return { ok: false, mensaje: 'Esa frase ya no existe.' };
    const previo = antes as Record<string, unknown>;
    // El país de una frase no cambia desde aquí: cada país tiene su propia cinta.
    const cambios = { text: datos.text, link_url: datos.link_url, is_active: datos.is_active };
    const { error } = await cliente.from('announcements').update(cambios).eq('id', datos.id);
    if (error) return { ok: false, ...traducirErrorBd(error) };
    await auditarCambio({ actor, accion: 'anuncios.actualizado', entidad: 'announcements', entidadId: datos.id, diff: diffCampos(previo, cambios), ip });
    invalidarContenido([previo.country_code as Pais]);
    return { ok: true, id: datos.id };
  }
  const nueva = {
    country_code: datos.country_code,
    text: datos.text,
    link_url: datos.link_url,
    is_active: datos.is_active,
    sort_order: await siguienteOrden(cliente, datos.country_code),
  };
  const { data, error } = await cliente.from('announcements').insert(nueva).select('id').single();
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'anuncios.creado', entidad: 'announcements', entidadId: data.id as string, diff: { despues: nueva }, ip });
  invalidarContenido([datos.country_code]);
  return { ok: true, id: data.id as string };
}

export async function alternarAnuncioBd(args: Ctx & { id: string; activo: boolean }): Promise<ResultadoAccion> {
  const { cliente, id, activo, actor, ip } = args;
  const { data: antes } = await cliente.from('announcements').select('country_code, is_active').eq('id', id).maybeSingle();
  if (!antes) return { ok: false, mensaje: 'Esa frase ya no existe.' };
  const { error } = await cliente.from('announcements').update({ is_active: activo }).eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: activo ? 'anuncios.activado' : 'anuncios.desactivado',
    entidad: 'announcements',
    entidadId: id,
    diff: { antes: { is_active: (antes as { is_active: boolean }).is_active }, despues: { is_active: activo } },
    ip,
  });
  invalidarContenido([(antes as { country_code: Pais }).country_code]);
  return { ok: true };
}

/** Sube o baja una frase una posición dentro de su país; renumera 10, 20, 30… solo lo que cambia. */
export async function moverAnuncioBd(args: Ctx & { id: string; direccion: 'arriba' | 'abajo' }): Promise<ResultadoAccion> {
  const { cliente, id, direccion, actor, ip } = args;
  const { data: actual } = await cliente.from('announcements').select('country_code').eq('id', id).maybeSingle();
  if (!actual) return { ok: false, mensaje: 'Esa frase ya no existe.' };
  const pais = (actual as { country_code: Pais }).country_code;
  const { data } = await cliente
    .from('announcements')
    .select('id, sort_order')
    .eq('country_code', pais)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const filas = (data ?? []) as { id: string; sort_order: number }[];
  const orden = moverEnLista(filas.map((f) => f.id), id, direccion);
  for (const [i, aid] of orden.entries()) {
    const nuevo = (i + 1) * PASO;
    if (filas.find((f) => f.id === aid)?.sort_order === nuevo) continue;
    const { error } = await cliente.from('announcements').update({ sort_order: nuevo }).eq('id', aid);
    if (error) return { ok: false, ...traducirErrorBd(error) };
  }
  await auditarCambio({ actor, accion: 'anuncios.movido', entidad: 'announcements', entidadId: id, diff: { despues: { direccion, country_code: pais } }, ip });
  invalidarContenido([pais]);
  return { ok: true };
}

export async function eliminarAnuncioBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const { data: antes } = await cliente.from('announcements').select('*').eq('id', id).maybeSingle();
  if (!antes) return { ok: true };
  const { error } = await cliente.from('announcements').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({ actor, accion: 'anuncios.eliminado', entidad: 'announcements', entidadId: id, diff: { antes }, ip });
  invalidarContenido([(antes as { country_code: Pais }).country_code]);
  return { ok: true };
}

export async function guardarRotacionBd(args: Ctx & { datos: DatosRotacion }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const antes = await leerRotacion(cliente, datos.country_code);
  const { error } = await cliente.from('country_settings').update({ announcement_rotation_seconds: datos.seconds }).eq('country_code', datos.country_code);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: 'anuncios.rotacion_ajustada',
    entidad: 'country_settings',
    entidadId: datos.country_code,
    diff: { antes: { announcement_rotation_seconds: antes }, despues: { announcement_rotation_seconds: datos.seconds } },
    ip,
  });
  invalidarContenido([datos.country_code]);
  return { ok: true };
}
