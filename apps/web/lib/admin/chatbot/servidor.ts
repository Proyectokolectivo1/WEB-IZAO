import 'server-only';
/**
 * Chatbot Iza (§20.6) con el cliente de servicio: ajustes de `chat_settings`, consumo del mes, conversión y
 * conversaciones (lista y lectura). Las conversaciones pueden traer datos personales que escribió el cliente: solo
 * las ve el administrador. La retención de 180 días la ejecuta un job, no el panel.
 */
import { inicioDiaBogotaUtc, sumarDias } from '@izao/core/metrics';
import { fromDbAmount } from '@izao/core/money';
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, escaparBusqueda, rangoPagina, type ResultadoAccion } from '../crud/comun';
import { invalidarContenido, traducirErrorBd } from '../crud/servidor';
import {
  bienvenidaAGuardar,
  conversionBp,
  type DatosAjustesChat,
  type FiltrosConversacion,
  type PaisChat,
} from './chatbot';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Monto = number | string | bigint;

export type AjustesChat = {
  is_enabled: boolean;
  model_primary: string | null;
  model_fallback: string | null;
  monthly_budget_usd_micros: bigint;
  degrade_at_pct: number;
  extra_instructions: string | null;
  welcome_message: Record<string, unknown>;
  max_output_tokens: number;
  history_turns: number;
  max_input_chars: number;
  max_messages_per_session: number;
};

const COLUMNAS_AJUSTES =
  'is_enabled, model_primary, model_fallback, monthly_budget_usd_micros, degrade_at_pct, extra_instructions, welcome_message, max_output_tokens, history_turns, max_input_chars, max_messages_per_session';

export async function leerAjustesChat(cliente: Cliente): Promise<AjustesChat | null> {
  const { data, error } = await cliente.from('chat_settings').select(COLUMNAS_AJUSTES).maybeSingle();
  if (error) throw new Error(`No se pudieron leer los ajustes del chatbot: ${error.message}`);
  if (!data) return null;
  const f = data as unknown as Omit<AjustesChat, 'monthly_budget_usd_micros'> & { monthly_budget_usd_micros: Monto };
  return { ...f, monthly_budget_usd_micros: fromDbAmount(f.monthly_budget_usd_micros), welcome_message: (f.welcome_message ?? {}) as Record<string, unknown> };
}

/** ¿Hay una credencial de OpenRouter activa? Sin ella Iza no puede responder (se configura en Integraciones). */
export async function hayCredencialOpenRouter(cliente: Cliente): Promise<boolean> {
  const { count, error } = await cliente
    .from('integration_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'openrouter')
    .eq('is_active', true);
  if (error) throw new Error(`No se pudo leer las credenciales: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function guardarAjustesChatBd(args: Ctx & { datos: DatosAjustesChat }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const { data: antes } = await cliente.from('chat_settings').select('*').maybeSingle();
  const previo = (antes ?? null) as Record<string, unknown> | null;
  const fila = {
    is_enabled: datos.is_enabled,
    model_primary: datos.model_primary,
    model_fallback: datos.model_fallback,
    monthly_budget_usd_micros: datos.monthly_budget_usd_micros.toString(),
    degrade_at_pct: datos.degrade_at_pct,
    extra_instructions: datos.extra_instructions,
    welcome_message: bienvenidaAGuardar((previo?.welcome_message ?? null) as Record<string, unknown> | null, datos.welcome),
    max_output_tokens: datos.max_output_tokens,
    history_turns: datos.history_turns,
    max_input_chars: datos.max_input_chars,
    max_messages_per_session: datos.max_messages_per_session,
  };
  const { error } = await cliente.from('chat_settings').upsert({ id: true, ...fila }, { onConflict: 'id' });
  if (error) return { ok: false, ...traducirErrorBd(error) };
  await auditarCambio({
    actor,
    accion: previo && previo.is_enabled !== fila.is_enabled ? (fila.is_enabled ? 'chatbot.activado' : 'chatbot.desactivado') : 'chatbot.ajustes_guardados',
    entidad: 'chat_settings',
    entidadId: 'global',
    diff: diffCampos(previo ? { ...previo, monthly_budget_usd_micros: String(previo.monthly_budget_usd_micros) } : null, fila),
    ip,
  });
  // El widget lee su configuración con las etiquetas de contenido del país.
  invalidarContenido();
  return { ok: true, id: 'global' };
}

// ── Consumo y conversión ─────────────────────────────────────────────────────────────────────────

export type ConsumoMes = { month: string; costo: bigint; mensajes: number };

/** Consumo de los últimos meses (el mes actual primero). */
export async function consumoReciente(cliente: Cliente, meses = 6): Promise<ConsumoMes[]> {
  const { data, error } = await cliente
    .from('chat_usage_monthly')
    .select('month, cost_usd_micros, messages')
    .order('month', { ascending: false })
    .limit(meses);
  if (error) throw new Error(`No se pudo leer el consumo: ${error.message}`);
  return ((data ?? []) as { month: string; cost_usd_micros: Monto; messages: number }[]).map((m) => ({
    month: m.month,
    costo: fromDbAmount(m.cost_usd_micros),
    mensajes: m.messages,
  }));
}

export type ConversionChat = { sesiones: number; convertidas: number; bp: bigint | null };

/** Sesiones con al menos un mensaje en `[desde, hasta]` y cuántas terminaron en pedido (ligadas por `visitor_id`). */
export async function conversionDelChat(cliente: Cliente, rango: { desde: string; hasta: string }): Promise<ConversionChat> {
  const ini = inicioDiaBogotaUtc(rango.desde).toISOString();
  const fin = inicioDiaBogotaUtc(sumarDias(rango.hasta, 1)).toISOString();
  const base = () => cliente.from('chat_sessions').select('id', { count: 'exact', head: true }).gt('messages_count', 0).gte('started_at', ini).lt('started_at', fin);
  const [todas, conv] = await Promise.all([base(), base().not('converted_order_id', 'is', null)]);
  if (todas.error || conv.error) throw new Error('No se pudo calcular la conversión del chat.');
  const sesiones = todas.count ?? 0;
  const convertidas = conv.count ?? 0;
  return { sesiones, convertidas, bp: conversionBp(convertidas, sesiones) };
}

// ── Conversaciones ───────────────────────────────────────────────────────────────────────────────

export type SesionChat = {
  id: string;
  country_code: PaisChat;
  visitor_id: string;
  customer_id: string | null;
  started_at: string;
  last_message_at: string | null;
  messages_count: number;
  converted_order_id: string | null;
};

const COLUMNAS_SESION = 'id, country_code, visitor_id, customer_id, started_at, last_message_at, messages_count, converted_order_id';

export async function listarSesiones(cliente: Cliente, f: FiltrosConversacion): Promise<{ filas: SesionChat[]; total: number }> {
  let ids: string[] | null = null;
  if (f.q) {
    const { data, error } = await cliente
      .from('chat_messages')
      .select('session_id')
      .in('role', ['user', 'assistant'])
      .ilike('content', `%${escaparBusqueda(f.q)}%`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(`No se pudo buscar en las conversaciones: ${error.message}`);
    ids = [...new Set(((data ?? []) as { session_id: string }[]).map((m) => m.session_id))];
    if (ids.length === 0) return { filas: [], total: 0 };
  }
  let q = cliente.from('chat_sessions').select(COLUMNAS_SESION, { count: 'exact' }).gt('messages_count', 0);
  if (ids) q = q.in('id', ids);
  if (f.pais) q = q.eq('country_code', f.pais);
  if (f.convertida === 'si') q = q.not('converted_order_id', 'is', null);
  if (f.convertida === 'no') q = q.is('converted_order_id', null);
  if (f.desde) q = q.gte('started_at', inicioDiaBogotaUtc(f.desde).toISOString());
  if (f.hasta) q = q.lt('started_at', inicioDiaBogotaUtc(sumarDias(f.hasta, 1)).toISOString());
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await q.order('started_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar las conversaciones: ${error.message}`);
  return { filas: (data ?? []) as unknown as SesionChat[], total: count ?? 0 };
}

export type MensajeChat = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  tool_calls: unknown;
  model: string | null;
  cost_usd_micros: bigint;
  created_at: string;
};

export type ConversacionChat = { sesion: SesionChat; mensajes: MensajeChat[]; costoTotal: bigint };

const MAX_MENSAJES = 300;

export async function obtenerConversacion(cliente: Cliente, id: string): Promise<ConversacionChat | null> {
  const { data, error } = await cliente.from('chat_sessions').select(COLUMNAS_SESION).eq('id', id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  if (!data) return null;
  const { data: msgs, error: e2 } = await cliente
    .from('chat_messages')
    .select('id, role, content, tool_calls, model, cost_usd_micros, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true })
    .limit(MAX_MENSAJES);
  if (e2) throw new Error(`No se pudieron leer los mensajes: ${e2.message}`);
  const mensajes = ((msgs ?? []) as unknown as (Omit<MensajeChat, 'cost_usd_micros'> & { cost_usd_micros: Monto })[]).map((m) => ({
    ...m,
    cost_usd_micros: fromDbAmount(m.cost_usd_micros),
  }));
  return { sesion: data as unknown as SesionChat, mensajes, costoTotal: mensajes.reduce((a, m) => a + m.cost_usd_micros, 0n) };
}

/** Nombres de las herramientas que llamó Iza en un mensaje (sin sus argumentos, que pueden traer datos del cliente). */
export function herramientasDe(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const nombres: string[] = [];
  for (const t of toolCalls) {
    const n = (t as { function?: { name?: unknown }; name?: unknown } | null);
    const nombre = typeof n?.function?.name === 'string' ? n.function.name : typeof n?.name === 'string' ? n.name : null;
    if (nombre && /^[a-z_]{1,40}$/.test(nombre)) nombres.push(nombre);
  }
  return nombres;
}
