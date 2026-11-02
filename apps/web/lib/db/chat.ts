/**
 * Envoltorio de `chat_registrar_turno(p_session_id, p_mensajes, p_ahora)` (`20261102050729_chat_registrar_turno.sql`).
 *
 * SOLO SERVIDOR (chat de Iza). En una sola transacción: bloquea la sesión, suma a `messages_count` los mensajes con
 * role `user`, mueve `last_message_at` (nunca hacia atrás) e inserta los mensajes conservando el orden del arreglo.
 * Devuelve el `messages_count` nuevo. El costo del mes sigue aparte con `chat_registrar_uso`.
 * Sesión inexistente → `ErrorDb` con código `P0002`; datos inválidos → `22023`. Contrato en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { llamarRpc } from './cliente';

export interface MensajeTurnoChat {
  role: 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: unknown;
  model?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  /** Micro-USD (entero ≥ 0). Se envía como texto para no perder precisión. */
  cost_usd_micros?: bigint | number | string;
}

/** Registra el turno y devuelve el contador de mensajes de la persona en la sesión. */
export async function registrarTurnoChatDb(sesionId: string, mensajes: MensajeTurnoChat[], ahora?: Date): Promise<number> {
  const p_mensajes = mensajes.map((m) => ({
    ...m,
    ...(m.cost_usd_micros === undefined ? {} : { cost_usd_micros: String(m.cost_usd_micros) }),
  }));
  const args: Record<string, unknown> = { p_session_id: sesionId, p_mensajes };
  if (ahora) args.p_ahora = ahora.toISOString();
  return llamarRpc('chat_registrar_turno', args, z.number().int().nonnegative());
}
