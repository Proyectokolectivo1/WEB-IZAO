import 'server-only';
/** Páginas y políticas del sitio (servicio, sin RLS): lectura, guardado con publicación única, eliminación. */
import { auditarCambio } from '@/lib/admin/auditoria';
import { publicarPaginaDb, type EntradaPagina, type ResultadoPagina } from '@/lib/db/panel-atomicas';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd, type Pais } from '../crud/servidor';
import {
  columnasPagina,
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

export type PublicarDb = (entrada: EntradaPagina) => Promise<ResultadoPagina>;

/**
 * Guarda la página con la RPC atómica `admin_publicar_pagina`: en UNA transacción escribe la página, sube `version` al
 * publicar o al cambiar el texto publicado y, si queda publicada y su tipo es único, pasa a borrador la que estaba
 * publicada del mismo país y tipo (o deshace todo si algo falla). El panel conserva la validación de marcadores, la
 * auditoría (sin el HTML completo) y la invalidación de `content:{país}` (el actual, el anterior y el de la reemplazada).
 */
export async function guardarPaginaBd(args: Ctx & { datos: DatosPagina; publicar?: PublicarDb }): Promise<ResultadoAccion & { despublicada?: string }> {
  const { datos, actor, ip } = args;
  const publicar = args.publicar ?? publicarPaginaDb;

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

  const r = await publicar({ ...(datos.id ? { id: datos.id } : {}), ...columnasPagina(datos), updated_by: actor });
  if (!r.ok) {
    switch (r.motivo) {
      case 'no_existe':
        return { ok: false, mensaje: 'Esa página ya no existe.' };
      case 'marcadores_pendientes':
        return { ok: false, mensaje: 'Resuelve los textos entre corchetes antes de publicar.', errores: { content_html: 'Quedan marcadores sin resolver.' } };
      case 'slug_duplicado':
        return { ok: false, mensaje: UNICOS.slug, errores: { slug: UNICOS.slug } };
      case 'publicada_duplicada':
        return { ok: false, mensaje: UNICOS.kind, errores: { kind: UNICOS.kind } };
      default:
        return { ok: false, mensaje: 'Revisa los campos marcados.' };
    }
  }

  const { id, antes, despublicada } = r;
  if (despublicada) {
    await auditarCambio({
      actor,
      accion: 'pages.despublicada',
      entidad: 'pages',
      entidadId: despublicada.id,
      diff: { antes: { status: 'published' }, despues: { status: 'draft' }, motivo: `reemplazada por ${id}` },
      ip,
    });
  }
  const despues = { ...columnasPagina(datos), version: r.version, content_html: `${datos.content_html.length} caracteres` };
  await auditarCambio({
    actor,
    accion: r.estado === 'creada' ? 'pages.creada' : antes && antes.status !== 'published' && datos.status === 'published' ? 'pages.publicada' : 'pages.actualizada',
    entidad: 'pages',
    entidadId: id,
    // El HTML completo no va al diff: solo qué campos cambiaron y su versión.
    diff: antes
      ? diffCampos(
          {
            country_code: antes.country_code,
            kind: antes.kind,
            slug: antes.slug,
            title: antes.title,
            status: antes.status,
            version: antes.version,
            seo_title: antes.seo_title,
            seo_description: antes.seo_description,
            content_html: `${antes.content_length} caracteres`,
          },
          despues,
        )
      : { despues },
    ip,
  });

  const paises = new Set<Pais>([datos.country_code as Pais]);
  if (antes) paises.add(antes.country_code as Pais);
  if (despublicada) paises.add(despublicada.country_code as Pais);
  invalidarContenido([...paises]);

  return { ok: true, id, ...(despublicada ? { despublicada: despublicada.title } : {}) };
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
