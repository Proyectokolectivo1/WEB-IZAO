import 'server-only';
/**
 * Plantillas de WhatsApp (§13.2) con el cliente de servicio: lectura, edición de borradores, versión nueva,
 * creación desde el texto por defecto y envío a aprobación de Meta. Cada escritura se audita (solo campos de
 * negocio, nunca credenciales) y las transiciones de estado son condicionales para que un doble clic o un
 * webhook simultáneo no pisen el estado.
 */
import {
  ErrorWhatsApp,
  PLANTILLAS_SEMILLA,
  nombreVersion,
  solicitudCreacion,
  type ClienteWhatsApp,
  type CredencialesWhatsApp,
} from '@izao/whatsapp';
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import { TOKEN_EJEMPLO, VALORES_EJEMPLO, normalizarMapa, posicionesDelTexto } from './etiquetas';
import {
  aPlantillaWhatsApp,
  validarCampos,
  type DatosPlantilla,
  type FilaPlantilla,
  type PaisPlantilla,
  type Problema,
} from './plantillas';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
export type ResultadoPlantilla = ResultadoAccion & { problemas?: Problema[] };

const COLUMNAS =
  'id, key, country_code, meta_template_name, meta_template_id, language, body_text, footer_text, button_text, button_url, variables_map, meta_status, meta_rejection_reason, version, is_active, updated_at';
const CAMPOS_AUDITADOS = ['language', 'body_text', 'footer_text', 'button_text', 'button_url', 'variables_map'] as const;

export async function listarPlantillas(cliente: Cliente, pais: PaisPlantilla): Promise<FilaPlantilla[]> {
  const { data, error } = await cliente
    .from('whatsapp_templates')
    .select(COLUMNAS)
    .eq('country_code', pais)
    .order('key', { ascending: true })
    .order('version', { ascending: false });
  if (error) throw new Error(`No se pudieron listar las plantillas: ${error.message}`);
  return (data ?? []) as never;
}

export async function obtenerPlantilla(cliente: Cliente, id: string): Promise<FilaPlantilla | null> {
  const { data, error } = await cliente.from('whatsapp_templates').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la plantilla: ${error.message}`);
  return (data as FilaPlantilla | null) ?? null;
}

function camposAuditados(f: Pick<FilaPlantilla, (typeof CAMPOS_AUDITADOS)[number]>): Record<string, unknown> {
  return Object.fromEntries(CAMPOS_AUDITADOS.map((c) => [c, f[c]]));
}

/** Guarda un borrador. Un borrador puede quedar con problemas: se devuelven para corregirlos antes de enviar. */
export async function guardarBorradorBd(args: Ctx & { datos: DatosPlantilla }): Promise<ResultadoPlantilla> {
  const { cliente, datos, actor, ip } = args;
  const antes = await obtenerPlantilla(cliente, datos.id);
  if (!antes) return { ok: false, mensaje: 'Esa plantilla ya no existe.' };
  if (antes.meta_status !== 'draft') {
    return { ok: false, mensaje: 'Solo se puede editar un borrador. Crea una versión nueva para cambiar el texto.' };
  }

  const hayBoton = Boolean(datos.button_text && datos.button_url);
  const nuevo = {
    language: datos.language,
    body_text: datos.body_text,
    footer_text: datos.footer_text,
    button_text: datos.button_text,
    button_url: datos.button_url,
    variables_map: normalizarMapa(datos.variables_map, hayBoton, posicionesDelTexto(datos.body_text)),
  };
  const { data, error } = await cliente
    .from('whatsapp_templates')
    .update({ ...nuevo, updated_at: new Date().toISOString() })
    .eq('id', datos.id)
    .eq('meta_status', 'draft')
    .select('id');
  if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, mensaje: 'La plantilla cambió de estado mientras la editabas. Recarga la página.' };
  }

  const diff = diffCampos(camposAuditados(antes), nuevo);
  if (Object.keys(diff.despues).length > 0) {
    await auditarCambio({
      actor,
      accion: 'whatsapp.plantilla_editada',
      entidad: 'whatsapp_templates',
      entidadId: datos.id,
      diff: { ...diff, clave: antes.key, pais: antes.country_code, version: antes.version },
      ip,
    });
  }
  const problemas = validarCampos({ ...antes, ...nuevo });
  return { ok: true, id: datos.id, mensaje: 'Borrador guardado.', problemas };
}

/**
 * Crea la versión siguiente de una plantilla como borrador, con el mismo texto. Si ya hay un borrador de esa
 * clave y país, lo devuelve en lugar de crear otro.
 */
export async function crearVersionBd(args: Ctx & { desdeId: string }): Promise<ResultadoAccion> {
  const { cliente, desdeId, actor, ip } = args;
  const origen = await obtenerPlantilla(cliente, desdeId);
  if (!origen) return { ok: false, mensaje: 'Esa plantilla ya no existe.' };

  const { data: hermanas, error: e1 } = await cliente
    .from('whatsapp_templates')
    .select('id, version, meta_status')
    .eq('key', origen.key)
    .eq('country_code', origen.country_code);
  if (e1) return { ok: false, mensaje: traducirErrorBd(e1).mensaje };
  const lista = (hermanas ?? []) as { id: string; version: number; meta_status: string }[];
  const borrador = lista.find((h) => h.meta_status === 'draft');
  if (borrador) return { ok: true, id: borrador.id, mensaje: 'Ya hay un borrador de esta plantilla; edítalo en lugar de crear otro.' };

  const version = Math.max(0, ...lista.map((h) => h.version)) + 1;
  const fila = {
    key: origen.key,
    country_code: origen.country_code,
    meta_template_name: nombreVersion(origen.key, version),
    category: 'UTILITY',
    language: origen.language,
    body_text: origen.body_text,
    footer_text: origen.footer_text,
    button_text: origen.button_text,
    button_url: origen.button_url,
    variables_map: origen.variables_map,
    meta_status: 'draft',
    version,
    is_active: false,
  };
  const { data, error } = await cliente.from('whatsapp_templates').insert(fila).select('id').single();
  if (error) {
    if (error.code === '23505') return { ok: false, mensaje: 'Otra persona creó una versión al mismo tiempo. Recarga la página.' };
    return { ok: false, mensaje: traducirErrorBd(error).mensaje };
  }
  const id = (data as { id: string } | null)?.id;
  if (!id) return { ok: false, mensaje: 'No se pudo crear la versión.' };
  await auditarCambio({
    actor,
    accion: 'whatsapp.plantilla_version_creada',
    entidad: 'whatsapp_templates',
    entidadId: id,
    diff: { clave: origen.key, pais: origen.country_code, version, desde: desdeId },
    ip,
  });
  return { ok: true, id, mensaje: `Versión ${version} creada como borrador.` };
}

/** Crea la versión 1 de una clave sin filas en el país, con el texto por defecto del paquete. */
export async function crearDesdeTextoPorDefectoBd(args: Ctx & { pais: PaisPlantilla; clave: string }): Promise<ResultadoAccion> {
  const { cliente, pais, clave, actor, ip } = args;
  const semilla = PLANTILLAS_SEMILLA.find((s) => s.key === clave);
  if (!semilla) return { ok: false, mensaje: 'Esa plantilla no existe.' };
  const { data: previas, error: e1 } = await cliente
    .from('whatsapp_templates')
    .select('id')
    .eq('key', clave)
    .eq('country_code', pais);
  if (e1) return { ok: false, mensaje: traducirErrorBd(e1).mensaje };
  if (Array.isArray(previas) && previas.length > 0) return { ok: false, mensaje: 'Ya existe esta plantilla en el país.' };

  const { data, error } = await cliente
    .from('whatsapp_templates')
    .insert({
      key: clave,
      country_code: pais,
      meta_template_name: nombreVersion(clave, 1),
      category: 'UTILITY',
      language: semilla.language,
      body_text: semilla.body_text,
      footer_text: semilla.footer_text,
      button_text: semilla.button_text,
      button_url: semilla.button_url,
      variables_map: semilla.variables_map,
      meta_status: 'draft',
      version: 1,
      is_active: false,
    })
    .select('id')
    .single();
  if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };
  const id = (data as { id: string } | null)?.id;
  if (!id) return { ok: false, mensaje: 'No se pudo crear la plantilla.' };
  await auditarCambio({
    actor,
    accion: 'whatsapp.plantilla_creada',
    entidad: 'whatsapp_templates',
    entidadId: id,
    diff: { clave, pais, version: 1 },
    ip,
  });
  return { ok: true, id, mensaje: 'Plantilla creada como borrador con el texto por defecto.' };
}

const MENSAJE_ERROR_META: Record<string, string> = {
  CREDENCIALES: 'Meta rechazó las credenciales de WhatsApp. Revísalas en Integraciones.',
  LIMITE: 'Meta pidió esperar por exceso de solicitudes. Inténtalo en unos minutos.',
  RED: 'No se pudo conectar con Meta. Inténtalo de nuevo.',
  PLANTILLA: 'Meta no aceptó la plantilla. Revisa el texto, el nombre y que no exista otra con ese nombre.',
  DESTINO: 'Meta no aceptó la solicitud.',
  HTTP: 'Meta no aceptó la solicitud.',
  RESPUESTA_INVALIDA: 'Meta respondió algo inesperado. Revisa el estado de la plantilla antes de reintentar.',
};

/**
 * Envía un borrador a aprobación. Primero lo reserva (borrador a en revisión, de forma condicional) para que un
 * doble clic no cree dos solicitudes; si Meta falla, lo devuelve a borrador. El resultado final (aprobada o
 * rechazada) llega por el webhook `message_template_status_update` y lo procesa el worker.
 */
export async function enviarAAprobacionBd(
  args: Ctx & {
    id: string;
    credenciales: (pais: PaisPlantilla) => Promise<CredencialesWhatsApp | null>;
    crearClienteMeta: (c: CredencialesWhatsApp) => ClienteWhatsApp;
  },
): Promise<ResultadoPlantilla> {
  const { cliente, id, actor, ip } = args;
  const fila = await obtenerPlantilla(cliente, id);
  if (!fila) return { ok: false, mensaje: 'Esa plantilla ya no existe.' };
  if (fila.meta_status !== 'draft') {
    return { ok: false, mensaje: 'Solo se envía a aprobación un borrador. Si fue rechazada, crea una versión nueva.' };
  }
  const problemas = validarCampos(fila);
  if (problemas.length > 0) {
    return { ok: false, mensaje: 'Corrige los problemas del texto antes de enviarla a Meta.', problemas };
  }

  const creds = await args.credenciales(fila.country_code);
  if (!creds) {
    return {
      ok: false,
      mensaje: 'Faltan las credenciales de WhatsApp de este país o no se pueden leer. Configúralas en Integraciones.',
    };
  }
  const solicitud = solicitudCreacion(aPlantillaWhatsApp(fila), VALORES_EJEMPLO, TOKEN_EJEMPLO);

  const reserva = await cliente
    .from('whatsapp_templates')
    .update({ meta_status: 'pending', meta_rejection_reason: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('meta_status', 'draft')
    .select('id');
  if (reserva.error) return { ok: false, mensaje: traducirErrorBd(reserva.error).mensaje };
  if (!Array.isArray(reserva.data) || reserva.data.length === 0) {
    return { ok: false, mensaje: 'Esta plantilla ya fue enviada. Recarga la página.' };
  }

  try {
    const r = await args.crearClienteMeta(creds).crearPlantilla(solicitud);
    // Si Meta ya la rechazó al crearla, queda rechazada; cualquier otro estado espera el webhook.
    const rechazada = r.status.toUpperCase() === 'REJECTED';
    await cliente
      .from('whatsapp_templates')
      .update({
        meta_template_id: r.meta_template_id,
        ...(rechazada
          ? {
              meta_status: 'rejected',
              meta_rejection_reason: 'Meta la rechazó al crearla. Revisa el motivo en el Administrador de WhatsApp.',
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('meta_status', 'pending');
    await auditarCambio({
      actor,
      accion: 'whatsapp.plantilla_enviada_a_aprobacion',
      entidad: 'whatsapp_templates',
      entidadId: id,
      diff: { clave: fila.key, pais: fila.country_code, version: fila.version, nombre_meta: fila.meta_template_name, estado_meta: r.status },
      ip,
    });
    return {
      ok: true,
      id,
      mensaje: rechazada
        ? 'Meta rechazó la plantilla al crearla.'
        : 'Enviada a Meta. La aprobación suele tardar de minutos a 24 horas; el estado se actualiza solo.',
    };
  } catch (e) {
    await cliente
      .from('whatsapp_templates')
      .update({ meta_status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('meta_status', 'pending')
      .is('meta_template_id', null);
    if (e instanceof ErrorWhatsApp) {
      const base = MENSAJE_ERROR_META[e.codigo] ?? 'Meta no aceptó la solicitud.';
      const detalle = e.metaCode ? ` (código ${e.metaCode})` : e.status ? ` (HTTP ${e.status})` : '';
      return { ok: false, mensaje: `${base}${detalle}` };
    }
    console.error('[panel] envío de plantilla a Meta falló:', e instanceof Error ? e.name : 'error');
    return { ok: false, mensaje: 'No se pudo enviar la plantilla. Inténtalo de nuevo.' };
  }
}
