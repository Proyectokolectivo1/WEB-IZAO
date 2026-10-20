import 'server-only';
/** Páginas y políticas del sitio (servicio, sin RLS): lectura, guardado con publicación única, eliminación. */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd, type Pais } from '../crud/servidor';
import {
  calcularVersion,
  columnasPagina,
  esTipoUnico,
  marcadoresPendientes,
  type DatosPagina,
  type EstadoPagina,
  type TipoPagina,
} from './paginas';

export type FilaPagina = {
  id: string;
  country_code: Pais;
  kind: TipoPagina;
  slug: string;
  title: string;
  content_html: string;
  seo_title: string | null;
  seo_description: string | null;
  status: EstadoPagina;
  version: number;
  updated_by: string | null;
  updated_at: string;
};

type Reemplazada = Pick<FilaPagina, 'id' | 'title' | 'country_code' | 'kind'>;
type Ctx = { cliente: Cliente; actor: string; ip: string | null };

const COLUMNAS = 'id, country_code, kind, slug, title, content_html, seo_title, seo_description, status, version, updated_by, updated_at';
const COLUMNAS_LISTA = 'id, country_code, kind, slug, title, status, version, updated_at';
const UNICOS = {
  slug: 'Ya hay una página con ese identificador de URL en este país.',
  kind: 'Ya hay otra página publicada de este tipo en el país.',
};

export type FiltrosPaginas = { pais: Pais; estado?: EstadoPagina | undefined; tipo?: TipoPagina | undefined };

export async function listarPaginas(cliente: Cliente, f: FiltrosPaginas): Promise<Omit<FilaPagina, 'content_html' | 'seo_title' | 'seo_description' | 'updated_by'>[]> {
  let consulta = cliente.from('pages').select(COLUMNAS_LISTA).eq('country_code', f.pais);
  if (f.estado) consulta = consulta.eq('status', f.estado);
  if (f.tipo) consulta = consulta.eq('kind', f.tipo);
  const { data, error } = await consulta.order('kind', { ascending: true }).order('title', { ascending: true });
  if (error) throw new Error(`No se pudieron listar las páginas: ${error.message}`);
  return (data ?? []) as never;
}

export async function obtenerPagina(cliente: Cliente, id: string): Promise<FilaPagina | null> {
  const { data, error } = await cliente.from('pages').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la página: ${error.message}`);
  return (data as FilaPagina | null) ?? null;
}

/** Páginas legales hoy publicadas (para avisar en el formulario qué se reemplaza). */
export async function publicadasUnicas(cliente: Cliente): Promise<{ id: string; country_code: Pais; kind: TipoPagina; title: string }[]> {
  const { data, error } = await cliente
    .from('pages')
    .select('id, country_code, kind, title')
    .eq('status', 'published')
    .neq('kind', 'general');
  if (error) throw new Error(`No se pudieron leer las páginas publicadas: ${error.message}`);
  return (data ?? []) as never;
}

/**
 * Guarda la página. Si queda publicada y su tipo es único, despublica (pasa a borrador) la que estaba
 * publicada del mismo país y tipo ANTES de escribir la nueva (el índice único no admite dos), y si la
 * escritura falla vuelve a publicar la anterior. Sube `version` al publicar o al cambiar el texto publicado
 * e invalida `content:{país}` (país actual y, si cambió, el anterior).
 *
 * No es una transacción de base de datos (supabase-js no las expone): ver "Pendiente" de la bitácora.
 */
export async function guardarPaginaBd(args: Ctx & { datos: DatosPagina }): Promise<ResultadoAccion & { despublicada?: string }> {
  const { cliente, datos, actor, ip } = args;
  const antes = datos.id ? await obtenerPagina(cliente, datos.id) : null;
  if (datos.id && !antes) return { ok: false, mensaje: 'Esa página ya no existe.' };

  if (datos.status === 'published') {
    const pendientes = marcadoresPendientes(datos.content_html);
    if (pendientes.length > 0) {
      return {
        ok: false,
        mensaje: 'Resuelve los textos entre corchetes antes de publicar.',
        errores: { content_html: `Quedan marcadores sin resolver: ${pendientes.slice(0, 5).join(', ')}.` },
      };
    }
  }

  const fila = {
    ...columnasPagina(datos),
    version: calcularVersion(antes, datos),
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };

  // Publicación única por país y tipo.
  let reemplazada = null as Reemplazada | null;
  if (datos.status === 'published' && esTipoUnico(datos.kind)) {
    let consulta = cliente
      .from('pages')
      .select('id, title, country_code, kind')
      .eq('country_code', datos.country_code)
      .eq('kind', datos.kind)
      .eq('status', 'published');
    if (datos.id) consulta = consulta.neq('id', datos.id);
    const { data, error } = await consulta.maybeSingle();
    if (error) return { ok: false, ...traducirErrorBd(error) };
    reemplazada = (data as Reemplazada | null) ?? null;
  }

  if (reemplazada) {
    const { error } = await cliente
      .from('pages')
      .update({ status: 'draft', updated_by: actor, updated_at: fila.updated_at })
      .eq('id', reemplazada.id);
    if (error) return { ok: false, ...traducirErrorBd(error) };
  }

  const restaurarAnterior = async () => {
    if (!reemplazada) return;
    const { error } = await cliente.from('pages').update({ status: 'published' }).eq('id', reemplazada.id);
    if (error) console.error('[panel] no se pudo restaurar la página publicada anterior:', reemplazada.id, error.message);
  };

  let id = datos.id ?? '';
  if (datos.id) {
    const { error } = await cliente.from('pages').update(fila).eq('id', datos.id);
    if (error) {
      await restaurarAnterior();
      return { ok: false, ...traducirErrorBd(error, UNICOS) };
    }
  } else {
    const { data, error } = await cliente.from('pages').insert(fila).select('id').single();
    if (error) {
      await restaurarAnterior();
      return { ok: false, ...traducirErrorBd(error, UNICOS) };
    }
    id = data.id as string;
  }

  if (reemplazada) {
    await auditarCambio({
      actor,
      accion: 'pages.despublicada',
      entidad: 'pages',
      entidadId: reemplazada.id,
      diff: { antes: { status: 'published' }, despues: { status: 'draft' }, motivo: `reemplazada por ${id}` },
      ip,
    });
  }
  await auditarCambio({
    actor,
    accion: antes ? (antes.status !== 'published' && datos.status === 'published' ? 'pages.publicada' : 'pages.actualizada') : 'pages.creada',
    entidad: 'pages',
    entidadId: id,
    // El HTML completo no va al diff: solo qué campos cambiaron y su versión.
    diff: antes
      ? diffCampos(
          { ...antes, content_html: `${antes.content_html.length} caracteres` },
          { ...fila, content_html: `${fila.content_html.length} caracteres` },
        )
      : { despues: { ...fila, content_html: `${fila.content_html.length} caracteres` } },
    ip,
  });

  const paises = new Set<Pais>([datos.country_code as Pais]);
  if (antes) paises.add(antes.country_code);
  if (reemplazada) paises.add(reemplazada.country_code);
  invalidarContenido([...paises]);

  return { ok: true, id, ...(reemplazada ? { despublicada: reemplazada.title } : {}) };
}

export async function eliminarPaginaBd(args: Ctx & { id: string }): Promise<ResultadoAccion> {
  const { cliente, id, actor, ip } = args;
  const antes = await obtenerPagina(cliente, id);
  if (!antes) return { ok: true };
  if (antes.status === 'published') {
    return { ok: false, mensaje: 'Una página publicada no se elimina. Pásala a borrador primero.' };
  }
  const { error } = await cliente.from('pages').delete().eq('id', id);
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: 'pages.eliminada',
    entidad: 'pages',
    entidadId: id,
    diff: { antes: { slug: antes.slug, title: antes.title, kind: antes.kind, version: antes.version } },
    ip,
  });
  invalidarContenido([antes.country_code]);
  return { ok: true };
}
