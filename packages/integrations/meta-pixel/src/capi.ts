/**
 * API de Conversiones de Meta (servidor), §23.2. SOLO SERVIDOR (usa `node:crypto`).
 *
 * Documentación oficial (verificada 2026-11-24, D-056):
 *  - `POST https://graph.facebook.com/{versión}/{PIXEL_ID}/events`; `access_token` como parámetro del POST.
 *  - `data[]` con `event_name`, `event_time` (segundos, máx. 7 días atrás), `event_id`, `action_source`, `user_data`,
 *    `custom_data`. Hasta 1 000 eventos por llamada.
 *  - Mismo `event_id` + `event_name` repetidos: Meta conserva solo el primero, así que reintentar no duplica y el
 *    evento del navegador (mismo id) se deduplica contra el del servidor.
 *  - `em` y `ph` se envían con SHA-256 hexadecimal: correo sin espacios y en minúsculas; teléfono solo dígitos con
 *    código de país y sin ceros a la izquierda; `country` en minúsculas, también con hash.
 *
 * Nunca se registra ni se devuelve el token: los errores lo redactan.
 */
import { createHash } from 'node:crypto';
import type { ParametrosContenido } from './eventos';

/** Versión por defecto de la Graph API (vigente según el registro de cambios de Meta al 2026-11-24). Se cambia con `META_GRAPH_VERSION`. */
export const GRAPH_VERSION_DEFECTO = 'v26.0';
const VERSION = /^v\d{1,3}\.\d$/;
export const GRAPH_ORIGEN = 'https://graph.facebook.com';
export const TIEMPO_LIMITE_MS = 10_000;

export const sha256Hex = (valor: string): string => createHash('sha256').update(valor, 'utf8').digest('hex');

/** Correo sin espacios en los extremos y en minúsculas; `null` si no parece un correo. */
export function normalizarCorreo(correo: string | null | undefined): string | null {
  const c = (correo ?? '').trim().toLowerCase();
  return c.includes('@') && c.length <= 254 ? c : null;
}

/** Solo dígitos, sin ceros a la izquierda; ya viene con código de país (E.164: `+573001234567` → `573001234567`). */
export function normalizarTelefono(telefono: string | null | undefined): string | null {
  const d = (telefono ?? '').replace(/\D+/g, '').replace(/^0+/, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export interface DatosUsuarioMeta {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  external_id?: string[];
  country?: string[];
  /** Sin hash (así lo pide Meta): cookies `_fbp`/`_fbc`, IP y user-agent del navegador al comprar. */
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

/** Nombre, apellido o ciudad: minúsculas, sin acentos, sin signos ni espacios (norma de Meta); `null` si queda vacío. */
export function normalizarTexto(texto: string | null | undefined): string | null {
  const t = (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return t || null;
}

/** Datos del navegador guardados con el pedido (solo si hubo consentimiento de marketing). */
export interface NavegadorMeta {
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  ua?: string | null;
}

/**
 * `user_data`: correo, teléfono, nombre, apellido, ciudad y país con SHA-256; `external_id` = número del pedido con hash;
 * `fbp`, `fbc`, IP y user-agent sin hash. Cuantos más campos, mejor coincidencia (Meta atribuye la venta al anuncio).
 */
export function datosUsuario(origen: {
  correo?: string | null;
  telefono?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  ciudad?: string | null;
  externalId?: string | null;
  navegador?: NavegadorMeta | null;
  pais: string;
}): DatosUsuarioMeta {
  const correo = normalizarCorreo(origen.correo);
  const telefono = normalizarTelefono(origen.telefono);
  const nombre = normalizarTexto(origen.nombre);
  const apellido = normalizarTexto(origen.apellido);
  const ciudad = normalizarTexto(origen.ciudad);
  const nav = origen.navegador ?? {};
  return {
    ...(correo ? { em: [sha256Hex(correo)] } : {}),
    ...(telefono ? { ph: [sha256Hex(telefono)] } : {}),
    ...(nombre ? { fn: [sha256Hex(nombre)] } : {}),
    ...(apellido ? { ln: [sha256Hex(apellido)] } : {}),
    ...(ciudad ? { ct: [sha256Hex(ciudad)] } : {}),
    ...(origen.externalId ? { external_id: [sha256Hex(origen.externalId)] } : {}),
    country: [sha256Hex(origen.pais.trim().toLowerCase())],
    ...(nav.fbp ? { fbp: nav.fbp } : {}),
    ...(nav.fbc ? { fbc: nav.fbc } : {}),
    ...(nav.ip ? { client_ip_address: nav.ip } : {}),
    ...(nav.ua ? { client_user_agent: nav.ua } : {}),
  };
}

export interface EventoServidor {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url?: string;
  user_data: DatosUsuarioMeta;
  custom_data: ParametrosContenido;
}

export function eventoCompra(d: {
  eventId: string;
  pagadoEn: Date;
  correo?: string | null;
  telefono?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  ciudad?: string | null;
  externalId?: string | null;
  navegador?: NavegadorMeta | null;
  pais: string;
  contenido: ParametrosContenido;
  urlPedido?: string;
}): EventoServidor {
  return {
    event_name: 'Purchase',
    event_time: Math.floor(d.pagadoEn.getTime() / 1000),
    event_id: d.eventId,
    action_source: 'website',
    ...(d.urlPedido ? { event_source_url: d.urlPedido } : {}),
    user_data: datosUsuario({
      correo: d.correo,
      telefono: d.telefono,
      nombre: d.nombre,
      apellido: d.apellido,
      ciudad: d.ciudad,
      externalId: d.externalId,
      navegador: d.navegador,
      pais: d.pais,
    }),
    custom_data: d.contenido,
  };
}

/** Error de la API: `reintentable` dice si vale la pena volver a intentar (red, 5xx, 429, límites de Meta). */
export class ErrorCapi extends Error {
  readonly estado: number | null;
  readonly codigo: number | null;
  readonly reintentable: boolean;
  readonly fbtraceId: string | null;
  constructor(mensaje: string, o: { estado: number | null; codigo: number | null; reintentable: boolean; fbtraceId: string | null }) {
    super(mensaje);
    this.name = 'ErrorCapi';
    this.estado = o.estado;
    this.codigo = o.codigo;
    this.reintentable = o.reintentable;
    this.fbtraceId = o.fbtraceId;
  }
}

// Códigos de límite o fallo temporal de la Graph API: 1 y 2 (error interno / servicio no disponible), 4, 17, 32, 613 (límites).
const CODIGOS_TEMPORALES = new Set([1, 2, 4, 17, 32, 613]);

const sinSecretos = (texto: string, token: string): string => (token ? texto.split(token).join('[token]') : texto).slice(0, 300);

export interface OpcionesEnvio {
  pixelId: string;
  /** Token de la API de Conversiones del país. */
  token: string;
  eventos: readonly EventoServidor[];
  version?: string;
  /** Código del Administrador de eventos > Probar eventos (solo pruebas). */
  testEventCode?: string;
  fetchImpl?: typeof fetch;
  tiempoLimiteMs?: number;
}

export interface ResultadoEnvio {
  eventosRecibidos: number;
  fbtraceId: string | null;
}

interface RespuestaGraph {
  events_received?: unknown;
  fbtrace_id?: unknown;
  error?: { message?: unknown; code?: unknown; fbtrace_id?: unknown };
}

export function versionGraph(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.META_GRAPH_VERSION?.trim();
  return v && VERSION.test(v) ? v : GRAPH_VERSION_DEFECTO;
}

export async function enviarEventosCapi(o: OpcionesEnvio): Promise<ResultadoEnvio> {
  if (o.eventos.length === 0) return { eventosRecibidos: 0, fbtraceId: null };
  if (!/^\d{5,20}$/.test(o.pixelId)) throw new ErrorCapi('Pixel ID inválido', { estado: null, codigo: null, reintentable: false, fbtraceId: null });
  const version = o.version && VERSION.test(o.version) ? o.version : GRAPH_VERSION_DEFECTO;
  const doFetch = o.fetchImpl ?? fetch;
  const cuerpo = { data: o.eventos, access_token: o.token, ...(o.testEventCode ? { test_event_code: o.testEventCode } : {}) };
  let res: Response;
  try {
    res = await doFetch(`${GRAPH_ORIGEN}/${version}/${o.pixelId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(o.tiempoLimiteMs ?? TIEMPO_LIMITE_MS),
    });
  } catch (e) {
    // Red o tiempo agotado: el mensaje de `fetch` puede traer la URL; solo se deja el nombre del error.
    throw new ErrorCapi(`Meta no respondió (${e instanceof Error ? e.name : 'error'})`, { estado: null, codigo: null, reintentable: true, fbtraceId: null });
  }
  let json = null as RespuestaGraph | null;
  try {
    json = (await res.json()) as RespuestaGraph | null;
  } catch {
    json = null;
  }
  const fbtraceId = typeof json?.fbtrace_id === 'string' ? json.fbtrace_id : typeof json?.error?.fbtrace_id === 'string' ? json.error.fbtrace_id : null;
  if (!res.ok) {
    const codigo = typeof json?.error?.code === 'number' ? json.error.code : null;
    const mensaje = typeof json?.error?.message === 'string' ? json.error.message : 'sin detalle';
    const reintentable = res.status === 429 || res.status >= 500 || (codigo !== null && CODIGOS_TEMPORALES.has(codigo));
    throw new ErrorCapi(`Meta respondió HTTP ${res.status}${codigo !== null ? ` (código ${codigo})` : ''}: ${sinSecretos(mensaje, o.token)}`, {
      estado: res.status,
      codigo,
      reintentable,
      fbtraceId,
    });
  }
  return { eventosRecibidos: typeof json?.events_received === 'number' ? json.events_received : 0, fbtraceId };
}
