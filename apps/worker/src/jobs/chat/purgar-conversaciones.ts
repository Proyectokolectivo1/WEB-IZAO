/**
 * Retención del chatbot (§20, §29): borra `chat_messages` con más de N días y `chat_sessions` sin actividad en N días
 * (N = 180 por defecto; `CHAT_RETENCION_DIAS` lo cambia, mínimo 30; no es configurable en `chat_settings`). Por lotes
 * e idempotente: repetirlo no borra nada más. NO toca `chat_usage_monthly` (consumo agregado). Los mensajes de una
 * sesión borrada caen por `on delete cascade`. Nunca se registran contenidos ni errores del servidor.
 */
export const JOB_CHAT_PURGAR = 'chat.purgar_conversaciones';
export const CRON_CHAT_PURGAR = '45 3 * * *';
export const DIAS_RETENCION_CHAT = 180;
export const LOTE_CHAT = 500;
const MAX_LOTES = 200;

export interface FuenteChat {
  /** Ids de mensajes anteriores a `corte` (ISO), hasta `limite`. */
  mensajesViejos(corte: string, limite: number): Promise<string[]>;
  /** Ids de sesiones sin actividad desde `corte` (ISO), hasta `limite`. */
  sesionesViejas(corte: string, limite: number): Promise<string[]>;
  borrarMensajes(ids: string[]): Promise<void>;
  borrarSesiones(ids: string[]): Promise<void>;
}

export function diasRetencionChat(env: string | undefined = process.env.CHAT_RETENCION_DIAS): number {
  const n = env === undefined ? NaN : Number(env);
  return Number.isSafeInteger(n) && n >= 30 ? n : DIAS_RETENCION_CHAT;
}

export async function purgarConversacionesChat(
  fuente: FuenteChat,
  opciones: { dias?: number; ahora?: () => Date } = {},
): Promise<{ mensajes: number; sesiones: number }> {
  const dias = opciones.dias ?? diasRetencionChat();
  const corte = new Date((opciones.ahora ?? (() => new Date()))().getTime() - dias * 86_400_000).toISOString();
  let mensajes = 0;
  let sesiones = 0;
  for (let i = 0; i < MAX_LOTES; i++) {
    const ids = await fuente.mensajesViejos(corte, LOTE_CHAT);
    if (ids.length === 0) break;
    await fuente.borrarMensajes(ids);
    mensajes += ids.length;
    if (ids.length < LOTE_CHAT) break;
  }
  for (let i = 0; i < MAX_LOTES; i++) {
    const ids = await fuente.sesionesViejas(corte, LOTE_CHAT);
    if (ids.length === 0) break;
    await fuente.borrarSesiones(ids);
    sesiones += ids.length;
    if (ids.length < LOTE_CHAT) break;
  }
  return { mensajes, sesiones };
}

export function fuenteChatPostgrest(o: { supabaseUrl: string; secretKey: string; fetchImpl?: typeof fetch }): FuenteChat {
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  const doFetch = o.fetchImpl ?? fetch;
  const cab = { apikey: o.secretKey, authorization: `Bearer ${o.secretKey}`, 'content-type': 'application/json' };
  const pedir = async (op: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await doFetch(url, { ...init, headers: cab, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`chat ${op} respondió HTTP ${res.status}`);
    return res;
  };
  const ids = async (op: string, url: string): Promise<string[]> =>
    ((await (await pedir(op, url)).json()) as { id: string }[]).map((f) => f.id);
  const lista = (x: string[]): string => `in.(${x.map(encodeURIComponent).join(',')})`;
  return {
    mensajesViejos: (corte, limite) =>
      ids('mensajes', `${base}/chat_messages?select=id&created_at=lt.${encodeURIComponent(corte)}&order=created_at.asc&limit=${limite}`),
    sesionesViejas: (corte, limite) => {
      const filtro = encodeURIComponent(`(last_message_at.lt.${corte},and(last_message_at.is.null,started_at.lt.${corte}))`);
      return ids('sesiones', `${base}/chat_sessions?select=id&or=${filtro}&order=started_at.asc&limit=${limite}`);
    },
    async borrarMensajes(x) {
      await pedir('borrado de mensajes', `${base}/chat_messages?id=${lista(x)}`, { method: 'DELETE' });
    },
    async borrarSesiones(x) {
      await pedir('borrado de sesiones', `${base}/chat_sessions?id=${lista(x)}`, { method: 'DELETE' });
    },
  };
}

export function dependenciasChatDesdeEnv(): FuenteChat {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL no está definida');
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY no está definida');
  return fuenteChatPostgrest({ supabaseUrl, secretKey });
}
