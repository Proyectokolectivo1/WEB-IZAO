/**
 * Job `meta.capi_purchase` (§23.2, skill izao-integraciones): envía el Purchase de un pedido pagado a la API de
 * Conversiones de Meta con el Pixel y el token **del país del pedido** (CO y EC tienen pixeles distintos).
 *
 * - Idempotente en tres capas: el `jobId` fijo por pedido (BullMQ), `order_events.meta_capi_purchase` (si ya se envió, no
 *   se vuelve a enviar) y el `event_id` determinista `purchase_{número}` que Meta usa para deduplicar, también contra el
 *   evento del navegador de la página `/pedido`.
 * - Un pedido sin pago (`paid_at` nulo) no envía nada. Sin credencial activa del país tampoco (y no falla).
 * - Opt-in estricto: sin `orders.marketing_consent` (cookie `izao_consent` con marketing aceptado al comprar) no se envía
 *   ni se lee la credencial; termina sin reintento (`sin_consentimiento`). Pedidos anteriores a la columna = `false`.
 * - Meta caído o límites (red, 5xx, 429): lanza para que BullMQ reintente con espera exponencial; el checkout y las
 *   transiciones del pedido nunca esperan este job. Rechazo definitivo (token inválido, datos): se anota en
 *   `order_events` (`meta_capi_error`) y no se reintenta.
 * - Nunca se registra el token ni datos personales; `user_data` va con SHA-256 (`@izao/meta-pixel/capi`).
 */
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import type { CountryCode } from '@izao/core/money';
import {
  ErrorCapi,
  enviarEventosCapi,
  eventoCompra,
  versionGraph,
  type EventoServidor,
  type OpcionesEnvio,
  type ResultadoEnvio,
} from '@izao/meta-pixel/capi';
import { crearFuenteConversionesPostgrest } from './fuente-postgrest.js';
import { idEventoCompra, monedaDePais, parametrosContenido, type LineaEvento } from '@izao/meta-pixel';

export const JOB_META_CAPI_PURCHASE = 'meta.capi_purchase';
export const EVENTO_CAPI_ENVIADO = 'meta_capi_purchase';
export const EVENTO_CAPI_ERROR = 'meta_capi_error';
const ACTOR = 'system';

export const jobIdCapiCompra = (orderId: string): string => `${JOB_META_CAPI_PURCHASE}.${orderId}`;

export interface PedidoConversion {
  id: string;
  numero: string;
  pais: CountryCode;
  pagadoEn: Date | null;
  /** `total_customer` en unidad menor. */
  total: bigint;
  correo: string | null;
  telefono: string | null;
  lineas: LineaEvento[];
  /** `orders.marketing_consent`; nulo o ausente = `false`. */
  consentimientoMarketing: boolean;
}

export interface CredencialMeta {
  pixelId: string;
  token: string;
}

export interface FuenteConversiones {
  pedido(orderId: string): Promise<PedidoConversion | null>;
  yaEnviado(orderId: string): Promise<boolean>;
  /** Credencial activa de `meta_pixel` del país; `null` si no hay o no se puede leer. */
  credencial(pais: CountryCode): Promise<CredencialMeta | null>;
  registrarEvento(orderId: string, tipo: string, actor: string, payload: Record<string, unknown>): Promise<void>;
}

export interface DepsConversiones {
  fuente: FuenteConversiones;
  /** Origen público https (`SITE_URL`), para `event_source_url`. */
  urlSitio: string;
  version?: string;
  enviar?: (o: OpcionesEnvio) => Promise<ResultadoEnvio>;
}

export type ResultadoCapi = { ok: true; accion: 'enviado' | 'ya_enviado' | 'no_pagado' | 'sin_consentimiento' | 'sin_credencial' | 'sin_pedido' | 'rechazado'; order_id: string };

export function parseDatosCapi(d: unknown): { order_id: string } | null {
  if (typeof d !== 'object' || d === null) return null;
  const id = (d as Record<string, unknown>).order_id;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? { order_id: id } : null;
}

export async function enviarCompraCapi(orderId: string, deps: DepsConversiones): Promise<ResultadoCapi> {
  const { fuente } = deps;
  const hecho = (accion: ResultadoCapi['accion']): ResultadoCapi => ({ ok: true, accion, order_id: orderId });
  const pedido = await fuente.pedido(orderId);
  if (!pedido) return hecho('sin_pedido');
  if (!pedido.pagadoEn) return hecho('no_pagado');
  if (pedido.consentimientoMarketing !== true) return hecho('sin_consentimiento');
  if (await fuente.yaEnviado(orderId)) return hecho('ya_enviado');
  const cred = await fuente.credencial(pedido.pais);
  if (!cred) return hecho('sin_credencial');

  const moneda = monedaDePais(pedido.pais);
  const eventId = idEventoCompra(pedido.numero);
  const evento: EventoServidor = eventoCompra({
    eventId,
    pagadoEn: pedido.pagadoEn,
    correo: pedido.correo,
    telefono: pedido.telefono,
    pais: pedido.pais,
    contenido: parametrosContenido(pedido.lineas, moneda, pedido.total),
    urlPedido: `${deps.urlSitio.replace(/\/+$/, '')}/${pedido.pais.toLowerCase()}`,
  });
  try {
    const r = await (deps.enviar ?? enviarEventosCapi)({ pixelId: cred.pixelId, token: cred.token, eventos: [evento], version: deps.version });
    await fuente.registrarEvento(orderId, EVENTO_CAPI_ENVIADO, ACTOR, {
      event_id: eventId,
      pixel_id: cred.pixelId,
      events_received: r.eventosRecibidos,
      fbtrace_id: r.fbtraceId,
    });
    return hecho('enviado');
  } catch (e) {
    if (e instanceof ErrorCapi && !e.reintentable) {
      await fuente.registrarEvento(orderId, EVENTO_CAPI_ERROR, ACTOR, {
        event_id: eventId,
        estado: e.estado,
        codigo: e.codigo,
        fbtrace_id: e.fbtraceId,
        mensaje: e.message,
      });
      return hecho('rechazado');
    }
    throw e;
  }
}

/** Manejador para la cola `sistema` (`crearProcesadorSistema({ [JOB_META_CAPI_PURCHASE]: … })`). */
export function crearManejadorCapiCompra(deps: DepsConversiones): Processor {
  return async (job: Job) => {
    const datos = parseDatosCapi(job.data);
    if (!datos) throw new UnrecoverableError(`${JOB_META_CAPI_PURCHASE}: datos inválidos`);
    const r = await enviarCompraCapi(datos.order_id, deps);
    console.log(`[meta] ${JOB_META_CAPI_PURCHASE} ${r.order_id}: ${r.accion}`);
    return r;
  };
}

export function dependenciasConversionesDesdeEnv(env: NodeJS.ProcessEnv = process.env): DepsConversiones {
  const supabaseUrl = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const claveCifrado = env.APP_ENCRYPTION_KEY;
  const urlSitio = env.SITE_URL;
  if (!supabaseUrl || !secretKey || !claveCifrado || !urlSitio) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY o SITE_URL para la API de Conversiones');
  }
  return { fuente: crearFuenteConversionesPostgrest({ supabaseUrl, secretKey, claveCifrado }), urlSitio, version: versionGraph(env) };
}
