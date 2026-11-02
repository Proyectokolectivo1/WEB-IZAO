/**
 * Datos y servicios de servidor del chat (SOLO SERVIDOR): ajustes de `chat_settings`, credencial cifrada de OpenRouter,
 * herramientas sobre el catálogo del país, tarjetas, sesiones, mensajes y consumo mensual. Rol de servicio (RLS niega
 * todo a `anon`). Nunca devuelve ni registra la llave del proveedor.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import { clienteDb } from '@/lib/db/cliente';
import { registrarTurnoChatDb, type MensajeTurnoChat } from '@/lib/db/chat';
import { enlaceWhatsapp } from '../contacto';
import { configCheckout, usarSupabase } from '../checkout-datos';
import { lineaDe, varianteInicial, presentacionDe } from '../ficha-util';
import { tienda } from '../datos';
import { ejemploPermitido } from '../modo-datos';
import { formatearPrecio } from '../pais';
import type { CodigoPais } from '../types';
import type { DepsHerramientas } from './herramientas';
import type { LLMProvider, TurnoGuardado } from './llm';
import { crearMock } from './mock';
import { crearOpenRouter } from './openrouter';
import type { ResultadoTurno, TarjetaChat } from './conversar';
import { mesDeUso } from './presupuesto';
import { registrarUsoMes, type ClienteRpc } from './uso';

export interface AjustesChat {
  habilitado: boolean;
  modeloPrimario: string | null;
  modeloRespaldo: string | null;
  presupuestoMicros: bigint;
  degradarPct: number;
  instruccionesExtra: string | null;
  /** `{ CO: "…", EC: "…" }` */
  bienvenida: Record<string, string>;
  maxTokens: number;
  turnos: number;
  maxEntrada: number;
  maxMensajesSesion: number;
}

const DEFECTOS: AjustesChat = {
  habilitado: false,
  modeloPrimario: null,
  modeloRespaldo: null,
  presupuestoMicros: 10_000_000n,
  degradarPct: 80,
  instruccionesExtra: null,
  bienvenida: {},
  maxTokens: 450,
  turnos: 12,
  maxEntrada: 500,
  maxMensajesSesion: 30,
};

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const entero = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : d);

/** `chat_settings` (fila única) con caché corta; el panel invalida `content:{PAÍS}` al guardar. */
export const leerAjustesChat = unstable_cache(
  async (): Promise<AjustesChat> => {
    const { data, error } = await clienteDb().from('chat_settings').select('*').maybeSingle();
    if (error) throw new Error(`chat_settings: ${error.message}`);
    if (!data) return DEFECTOS;
    const f = data as Record<string, unknown>;
    const bienvenida: Record<string, string> = {};
    if (f.welcome_message && typeof f.welcome_message === 'object') {
      for (const [k, v] of Object.entries(f.welcome_message as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) bienvenida[k.toUpperCase()] = v.trim();
    }
    return {
      habilitado: f.is_enabled === true,
      modeloPrimario: texto(f.model_primary),
      modeloRespaldo: texto(f.model_fallback),
      presupuestoMicros: BigInt(String(f.monthly_budget_usd_micros ?? DEFECTOS.presupuestoMicros)),
      degradarPct: entero(f.degrade_at_pct, DEFECTOS.degradarPct),
      instruccionesExtra: texto(f.extra_instructions),
      bienvenida,
      maxTokens: entero(f.max_output_tokens, DEFECTOS.maxTokens),
      turnos: entero(f.history_turns, DEFECTOS.turnos),
      maxEntrada: entero(f.max_input_chars, DEFECTOS.maxEntrada),
      maxMensajesSesion: entero(f.max_messages_per_session, DEFECTOS.maxMensajesSesion),
    };
  },
  ['chat-ajustes'],
  { revalidate: 30, tags: ['content:CO', 'content:EC'] },
);

// ── Proveedor ──────────────────────────────────────────────────────────────────────────────────────

/** Llave de OpenRouter de la credencial activa global (`provider = openrouter`, sin país); `null` si no hay. */
async function llaveOpenRouter(): Promise<string | null> {
  const clave = process.env.APP_ENCRYPTION_KEY;
  if (!clave) return null;
  const { data, error } = await clienteDb()
    .from('integration_credentials')
    .select('environment,data_encrypted,iv,key_version')
    .eq('provider', 'openrouter')
    .is('country_code', null)
    .eq('is_active', true);
  if (error || !data || data.length !== 1) return null;
  const r = data[0] as Record<string, unknown>;
  try {
    const valores = await descifrarCredenciales(
      clave,
      { provider: 'openrouter', country_code: null, environment: r.environment === 'production' ? 'production' : 'sandbox' },
      { data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)), iv: byteaDesdePostgrest(String(r.iv)), key_version: Number(r.key_version) },
    );
    return texto(valores.api_key);
  } catch (e) {
    console.error(`[iza] credencial de OpenRouter ilegible: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}

/**
 * OpenRouter con la credencial del panel. Sin credencial (o si no se puede descifrar) responde el proveedor de prueba SOLO
 * donde se permiten datos de ejemplo (desarrollo y pruebas); en producción devuelve `null` y el chat queda en modo asesor
 * por WhatsApp, nunca con respuestas de demostración.
 */
export async function crearProveedor(): Promise<LLMProvider | null> {
  const apiKey = await llaveOpenRouter().catch(() => null);
  if (!apiKey) return ejemploPermitido() ? crearMock() : null;
  return crearOpenRouter({ apiKey, sitio: process.env.SITE_URL ?? 'https://izaoperfumeria.com', titulo: 'Izao Perfumería' });
}

// ── Consumo mensual ──────────────────────────────────────────────────────────────────────────────

/** ¿Se muestra el botón de Iza? Sin base (desarrollo con datos de ejemplo) sí, con el proveedor de prueba. */
export async function chatHabilitado(): Promise<boolean> {
  if (!usarSupabase()) return ejemploPermitido();
  try {
    return (await leerAjustesChat()).habilitado;
  } catch {
    return false;
  }
}

export async function gastadoDelMes(ahora = new Date()): Promise<bigint> {
  const { data, error } = await clienteDb().from('chat_usage_monthly').select('cost_usd_micros').eq('month', mesDeUso(ahora)).maybeSingle();
  if (error) throw new Error(`chat_usage_monthly: ${error.message}`);
  return BigInt(String((data as { cost_usd_micros?: number | string } | null)?.cost_usd_micros ?? 0));
}

/** Suma el costo de un turno y un mensaje al mes con la RPC atómica `chat_registrar_uso` (ver `uso.ts`). */
export async function sumarUso(costoMicros: bigint): Promise<void> {
  await registrarUsoMes(clienteDb() as unknown as ClienteRpc, costoMicros);
}

// ── Sesiones y mensajes ──────────────────────────────────────────────────────────────────────────

export interface SesionChat {
  id: string;
  mensajes: number;
}

export async function crearSesion(pais: CodigoPais, visitorId: string): Promise<SesionChat> {
  const { data, error } = await clienteDb()
    .from('chat_sessions')
    .insert({ country_code: pais.toUpperCase(), visitor_id: visitorId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`chat_sessions: ${error?.message ?? 'sin fila'}`);
  return { id: String((data as { id: string }).id), mensajes: 0 };
}

/** La sesión debe existir y ser del mismo país y visitante; si no, `null` (se tratará como sesión nueva). */
export async function leerSesion(id: string, pais: CodigoPais, visitorId: string): Promise<SesionChat | null> {
  const { data, error } = await clienteDb()
    .from('chat_sessions')
    .select('id,messages_count')
    .eq('id', id)
    .eq('country_code', pais.toUpperCase())
    .eq('visitor_id', visitorId)
    .maybeSingle();
  if (error) throw new Error(`chat_sessions: ${error.message}`);
  if (!data) return null;
  return { id: String((data as { id: string }).id), mensajes: Number((data as { messages_count: number }).messages_count) };
}

export async function historialSesion(sesionId: string, turnos: number): Promise<TurnoGuardado[]> {
  const { data, error } = await clienteDb()
    .from('chat_messages')
    .select('role,content,created_at')
    .eq('session_id', sesionId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(turnos * 2);
  if (error) throw new Error(`chat_messages: ${error.message}`);
  return ((data ?? []) as { role: 'user' | 'assistant'; content: string | null }[])
    .reverse()
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content ?? '' }));
}

/**
 * Guarda el turno completo (pregunta y respuesta) con la RPC atómica `chat_registrar_turno`: inserta los mensajes y suma
 * `messages_count` / `last_message_at` en una sola transacción, así dos turnos a la vez no se pisan. Devuelve el contador nuevo.
 */
export async function guardarTurno(sesion: SesionChat, mensaje: string, r: ResultadoTurno | null, ahora = new Date()): Promise<number> {
  const mensajes: MensajeTurnoChat[] = [{ role: 'user', content: mensaje }];
  if (r && (r.texto || r.herramientas.length > 0)) {
    mensajes.push({
      role: 'assistant',
      content: r.texto || null,
      tool_calls: r.herramientas.length > 0 ? r.herramientas : null,
      model: r.modelo,
      tokens_in: r.tokensIn,
      tokens_out: r.tokensOut,
      cost_usd_micros: r.costoMicros,
    });
  }
  return registrarTurnoChatDb(sesion.id, mensajes, ahora);
}

// ── Herramientas y tarjetas ──────────────────────────────────────────────────────────────────────

const aTexto = (html: string) =>
  html
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

const KIND_POR_TEMA = { envios: 'envios', tiempos_entrega: 'envios', garantias: 'devoluciones', devoluciones: 'devoluciones' } as const;

export function herramientasDePais(pais: CodigoPais): DepsHerramientas {
  const repo = tienda();
  const upper = pais.toUpperCase();
  return {
    pais,
    async buscar(c) {
      const r = await repo.catalogo(pais, {
        ...(c.texto ? { q: c.texto } : {}),
        filtros: {
          ...(c.genero ? { gender: c.genero } : {}),
          ...(c.familia ? { families: [c.familia] } : {}),
          ...(c.precioMin !== undefined ? { price_min: c.precioMin } : {}),
          ...(c.precioMax !== undefined ? { price_max: c.precioMax } : {}),
        },
        orden: c.texto ? 'relevance' : 'featured',
        cursor: null,
        limite: c.limite,
      });
      return r.items;
    },
    ficha: (slug) => repo.producto(pais, slug),
    async politica(tema) {
      const p = await repo.paginaPorTipo(pais, KIND_POR_TEMA[tema]);
      return p ? { titulo: p.title, texto: aTexto(p.content_html) } : null;
    },
    async metodos() {
      const c = await configCheckout(pais);
      return {
        metodos: c.metodos.map((m) => ({ nombre: m.nombre, descripcion: m.descripcion, tipo: m.method })),
        contraEntrega: { habilitada: c.codHabilitado, abono: formatearPrecio(c.codAbono, pais), minimoRecaudo: formatearPrecio(c.codMinimoRecaudo, pais) },
        recargoFinanciacion: c.recargoFinanciacion,
      };
    },
    async pedido(numero, celularE164) {
      const db = clienteDb();
      const { data, error } = await db
        .from('orders')
        .select('id,status,contact_phone_e164')
        .eq('number', numero)
        .eq('country_code', upper)
        .maybeSingle();
      if (error) throw new Error(`orders: ${error.message}`);
      const o = data as { id: string; status: string; contact_phone_e164: string | null } | null;
      if (!o || o.contact_phone_e164 !== celularE164) return null;
      const g = await db.from('shipments').select('carrier_name,tracking_code,tracking_url').eq('order_id', o.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const s = g.data as { carrier_name: string | null; tracking_code: string | null; tracking_url: string | null } | null;
      return { estado: o.status, guia: s?.tracking_code ? { transportadora: s.carrier_name, codigo: s.tracking_code, url: s.tracking_url } : null };
    },
    async codigosIza() {
      const ahora = Date.now();
      const { data, error } = await clienteDb()
        .from('discount_codes')
        .select('code,type,value,max_discount_amount,starts_at,ends_at,usage_limit_total,usage_count,min_subtotal')
        .eq('country_code', upper)
        .eq('iza_can_offer', true)
        .eq('is_active', true);
      if (error) throw new Error(`discount_codes: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[])
        // Fechas como instantes (no como texto): PostgREST puede devolver distintos formatos de zona horaria.
        .filter((c) => (!c.starts_at || Date.parse(String(c.starts_at)) <= ahora) && (!c.ends_at || Date.parse(String(c.ends_at)) > ahora))
        .filter((c) => c.usage_limit_total == null || Number(c.usage_count) < Number(c.usage_limit_total))
        .map((c) => ({
          codigo: String(c.code),
          descripcion:
            (c.type === 'percent' ? `${c.value}% de descuento` : `${formatearPrecio(String(c.value), pais)} de descuento`) +
            (c.type === 'percent' && c.max_discount_amount ? ` (tope de ${formatearPrecio(String(c.max_discount_amount), pais)})` : '') +
            (Number(c.min_subtotal) > 0 ? ` en compras desde ${formatearPrecio(String(c.min_subtotal), pais)}` : ''),
        }));
    },
    enlaceAsesor: () => null, // se completa con `conWhatsapp`
  };
}

/** Agrega el enlace de WhatsApp del asesor del país (con el motivo como contexto). */
export function conWhatsapp(deps: DepsHerramientas, numero: string | null, nombreTienda: string): DepsHerramientas {
  return {
    ...deps,
    enlaceAsesor: (motivo) => enlaceWhatsapp(numero, `Hola ${nombreTienda}, vengo del chat con Iza.${motivo ? ` Motivo: ${motivo.slice(0, 160)}` : ''}`),
  };
}

/** Tarjeta de un producto visible en el país (por `repo.producto`, que solo devuelve visibles); `null` si no existe. */
export function tarjetaDePais(pais: CodigoPais) {
  const repo = tienda();
  return async (slug: string): Promise<TarjetaChat | null> => {
    const f = await repo.producto(pais, slug).catch(() => null);
    if (!f) return null;
    const v = varianteInicial(f.variants);
    const disponible = v?.in_stock === true;
    return {
      slug: f.slug,
      nombre: f.name,
      presentacion: v ? presentacionDe(f, v) : null,
      precio: formatearPrecio(v?.price ?? f.min_price, pais),
      disponible,
      url: `/${pais}/perfume/${f.slug}`,
      imagen: (() => {
        const m = v?.image ?? f.img_primary ?? f.images[0]?.media ?? null;
        return m ? { variants: m.variants ?? null, lqip: m.lqip ?? null, alt: m.alt ?? null, width: m.width ?? null, height: m.height ?? null } : null;
      })(),
      linea: v && disponible ? lineaDe(f, v) : null,
    };
  };
}
