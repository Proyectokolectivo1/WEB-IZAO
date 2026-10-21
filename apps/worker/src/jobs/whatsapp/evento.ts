/**
 * Job `whatsapp.evento` de la cola `whatsapp` (dueño: izao-pagos, §13.2–13.3, D-025). El webhook guarda el
 * `EventoWhatsApp` en `webhook_events (provider 'whatsapp', event_id)` y encola `{ event_id }`; aquí se relee y aplica.
 * El arranque (izao-infra) debe:
 *   createWorker(COLA_WHATSAPP, crearProcesadorWhatsApp(dependenciasWhatsAppDesdeEnv()), connection)
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY, SITE_URL.
 *
 * - Estados de mensajes: solo avanzan (queued → sent → delivered → read) por update condicional; `failed` solo desde
 *   queued/sent y dispara alerta en el pedido + correo de respaldo con `/pagar/{token}` si sigue esperando el abono.
 * - Plantillas: `APPROVED` activa esa versión y desactiva la anterior (salvo que la activa sea más nueva);
 *   `REJECTED` guarda `meta_rejection_reason`; `PAUSED`/`DISABLED` → `paused`; `PENDING` → `pending`.
 */
import type { Processor } from 'bullmq';
import { JOB_WA_EVENTO, type EventoWhatsApp } from '@izao/whatsapp';
import type { CorreoRespaldo } from '../cod/index.js';
import { crearFuenteWaPostgrest } from './fuente-postgrest.js';
import type { EstadoMensajeFila, FuenteEventosWa } from './fuente.js';

export { COLA_WHATSAPP, JOB_WA_EVENTO } from '@izao/whatsapp';

export interface DepsEventoWa {
  fuente: FuenteEventosWa;
  /** Sin proveedor de correo definido: si falta, la alerta lo dice (`correo: sin_proveedor`). */
  correoRespaldo?: CorreoRespaldo;
  /** Origen público https (`SITE_URL`). */
  urlSitio: string;
  ahora?: () => Date;
}

export type AccionEventoWa =
  | 'evento_no_encontrado'
  | 'ya_procesado'
  | 'invalido'
  | 'actualizado'
  | 'sin_cambio'
  | 'mensaje_desconocido'
  | 'fallido'
  | 'activada'
  | 'aprobada'
  | 'aprobada_sin_activar'
  | 'rechazada'
  | 'pausada'
  | 'pendiente'
  | 'plantilla_desconocida'
  | 'ignorado';

export type EstadoCorreo = 'enviado' | 'sin_proveedor' | 'sin_correo' | 'no_aplica';

export interface ResultadoEventoWa {
  accion: AccionEventoWa;
  correo?: EstadoCorreo;
}

export class ErrorReintentableWa extends Error {
  constructor(readonly motivo: string) {
    super(`whatsapp.evento reintentable: ${motivo}`);
    this.name = 'ErrorReintentableWa';
  }
}

/** Un estado de un wamid que aún no está en la base se reintenta durante este tiempo (carrera con `marcarMensaje`). */
const ESPERA_WAMID_MS = 10 * 60_000;

const ORDEN: Record<Exclude<EstadoMensajeFila, 'failed'>, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
const ANTERIORES = (s: Exclude<EstadoMensajeFila, 'failed'>): EstadoMensajeFila[] =>
  (Object.keys(ORDEN) as (keyof typeof ORDEN)[]).filter((k) => ORDEN[k] < ORDEN[s]);

function esEvento(p: unknown): p is EventoWhatsApp {
  if (!p || typeof p !== 'object') return false;
  const e = p as Record<string, unknown>;
  if (typeof e.event_id !== 'string') return false;
  if (e.tipo === 'estado_mensaje') {
    const err = e.error as { code?: unknown; text?: unknown } | null;
    return (
      typeof e.wa_message_id === 'string' &&
      e.wa_message_id !== '' &&
      typeof e.status === 'string' &&
      ['sent', 'delivered', 'read', 'failed'].includes(e.status) &&
      typeof e.timestamp === 'number' &&
      (err === null || (typeof err === 'object' && typeof err.code === 'string' && typeof err.text === 'string'))
    );
  }
  if (e.tipo === 'estado_plantilla') {
    return (
      typeof e.meta_template_id === 'string' &&
      typeof e.meta_template_name === 'string' &&
      typeof e.language === 'string' &&
      typeof e.event === 'string' &&
      (e.reason === null || typeof e.reason === 'string')
    );
  }
  return false;
}

async function respaldo(deps: DepsEventoWa, orderId: string, ahora: Date): Promise<EstadoCorreo> {
  const p = await deps.fuente.pedido(orderId);
  if (!p || p.payment_method !== 'cod' || p.status !== 'esperando_abono') return 'no_aplica';
  const pay = await deps.fuente.payLink(p.id);
  if (!pay || pay.expires_at.getTime() <= ahora.getTime()) return 'no_aplica';
  if (!p.contact_email) return 'sin_correo';
  if (!deps.correoRespaldo) return 'sin_proveedor';
  await deps.correoRespaldo({ order_id: p.id, email: p.contact_email, url: `${deps.urlSitio.replace(/\/+$/, '')}/pagar/${pay.token}` });
  return 'enviado';
}

async function estadoMensaje(e: Extract<EventoWhatsApp, { tipo: 'estado_mensaje' }>, deps: DepsEventoWa, ahora: Date): Promise<ResultadoEventoWa> {
  const { fuente } = deps;
  const m = await fuente.mensajePorWamid(e.wa_message_id);
  if (!m) {
    if (ahora.getTime() - e.timestamp * 1000 < ESPERA_WAMID_MS) throw new ErrorReintentableWa('mensaje_no_registrado');
    return { accion: 'mensaje_desconocido' };
  }
  if (e.status !== 'failed') {
    return { accion: (await fuente.actualizarMensaje(m.id, ANTERIORES(e.status), { status: e.status })) ? 'actualizado' : 'sin_cambio' };
  }
  const codigo = e.error?.code ?? 'desconocido';
  const cambio = await fuente.actualizarMensaje(m.id, ['queued', 'sent'], {
    status: 'failed',
    error_code: codigo.slice(0, 40),
    error_text: (e.error?.text ?? '').slice(0, 300),
  });
  // Ya `failed` con este wamid = un intento anterior de ESTE evento cayó antes de terminar: se repite el respaldo.
  if (!cambio && m.status !== 'failed') return { accion: 'sin_cambio' };
  if (!m.order_id) return { accion: 'fallido' };
  const correo = await respaldo(deps, m.order_id, ahora);
  await fuente.registrarAlerta(m.order_id, 'whatsapp_fallido', { plantilla: m.template_key || null, codigo, correo });
  return { accion: 'fallido', correo };
}

async function estadoPlantilla(e: Extract<EventoWhatsApp, { tipo: 'estado_plantilla' }>, deps: DepsEventoWa): Promise<ResultadoEventoWa> {
  const { fuente } = deps;
  const t = await fuente.plantillaPorMeta(e.meta_template_id, e.meta_template_name, e.language);
  if (!t) return { accion: 'plantilla_desconocida' };
  const id = t.meta_template_id ? {} : { meta_template_id: e.meta_template_id };
  switch (e.event) {
    case 'APPROVED': {
      const activa = await fuente.plantillaActivaDe(t.key, t.country_code);
      if (activa && activa.id !== t.id && activa.version > t.version) {
        await fuente.actualizarPlantilla(t.id, { meta_status: 'approved', meta_rejection_reason: null, ...id });
        return { accion: 'aprobada_sin_activar' };
      }
      if (activa?.id === t.id) {
        await fuente.actualizarPlantilla(t.id, { meta_status: 'approved', meta_rejection_reason: null, ...id });
        return { accion: 'aprobada' };
      }
      const r = await fuente.activarPlantilla(t, e.meta_template_id);
      return { accion: r === 'ya_activa' ? 'aprobada' : r };
    }
    case 'REJECTED':
      await fuente.actualizarPlantilla(t.id, { meta_status: 'rejected', meta_rejection_reason: e.reason, ...id });
      return { accion: 'rechazada' };
    case 'PAUSED':
    case 'DISABLED':
      await fuente.actualizarPlantilla(t.id, { meta_status: 'paused', meta_rejection_reason: e.reason ? `${e.event}: ${e.reason}` : e.event, ...id });
      if (t.is_active) console.warn(`[worker] plantilla activa ${t.key}/${t.country_code} quedó ${e.event} en Meta`);
      return { accion: 'pausada' };
    case 'PENDING':
      await fuente.actualizarPlantilla(t.id, { meta_status: 'pending', meta_rejection_reason: null, ...id });
      return { accion: 'pendiente' };
    default:
      return { accion: 'ignorado' };
  }
}

export async function procesarEventoWhatsApp(eventId: string, deps: DepsEventoWa): Promise<ResultadoEventoWa> {
  const { fuente } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const ev = await fuente.evento(eventId);
  if (!ev) return { accion: 'evento_no_encontrado' };
  if (ev.procesado) return { accion: 'ya_procesado' };
  if (!esEvento(ev.payload)) {
    await fuente.marcarEvento(eventId, { ok: false, error: 'payload_invalido' });
    return { accion: 'invalido' };
  }
  const e = ev.payload;
  try {
    const r = e.tipo === 'estado_mensaje' ? await estadoMensaje(e, deps, ahora) : await estadoPlantilla(e, deps);
    await fuente.marcarEvento(eventId, { ok: true });
    return r;
  } catch (err) {
    const motivo = err instanceof ErrorReintentableWa ? err.motivo : err instanceof Error ? err.name : 'error';
    await fuente.marcarEvento(eventId, { ok: false, error: motivo }).catch(() => undefined);
    throw err;
  }
}

export function crearProcesadorWhatsApp(deps: DepsEventoWa): Processor {
  return async (job) => {
    if (job.name !== JOB_WA_EVENTO) return { ok: true, ignorado: job.name };
    const id = (job.data as { event_id?: unknown } | null)?.event_id;
    if (typeof id !== 'string' || id === '' || id.length > 300) return { ok: false, motivo: 'datos_invalidos' };
    const r = await procesarEventoWhatsApp(id, deps);
    console.log(`[worker] ${JOB_WA_EVENTO}: ${r.accion}`);
    return r;
  };
}

export function dependenciasWhatsAppDesdeEnv(correoRespaldo?: CorreoRespaldo): DepsEventoWa {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  const urlSitio = process.env.SITE_URL;
  if (!supabaseUrl || !secretKey || !claveCifrado || !urlSitio) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY o SITE_URL para la cola whatsapp');
  }
  return {
    fuente: crearFuenteWaPostgrest({ supabaseUrl, secretKey, claveCifrado }),
    ...(correoRespaldo ? { correoRespaldo } : {}),
    urlSitio,
  };
}
