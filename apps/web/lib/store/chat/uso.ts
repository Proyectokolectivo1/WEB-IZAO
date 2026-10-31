/**
 * Consumo mensual del chat (§20.4): suma el costo de un turno con la RPC atómica `chat_registrar_uso` (izao-db), que
 * suma costo y mensajes en la fila del mes (hora de Bogotá, global) y devuelve el total del mes en micro-USD. Solo
 * `service_role`; rechaza costos nulos o negativos con 22023.
 */

export interface ClienteRpc {
  rpc(nombre: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** Devuelve el total del mes en micro-USD tras sumar este turno. Lanza si la base rechaza la llamada. */
export async function registrarUsoMes(cliente: ClienteRpc, costoMicros: bigint, mensajes = 1): Promise<bigint> {
  if (costoMicros < 0n) throw new Error('El costo no puede ser negativo.');
  const { data, error } = await cliente.rpc('chat_registrar_uso', { p_costo_micros: String(costoMicros), p_mensajes: mensajes });
  if (error) throw new Error(`chat_registrar_uso: ${error.code ?? ''} ${error.message}`.trim());
  return BigInt(String(data ?? 0));
}
