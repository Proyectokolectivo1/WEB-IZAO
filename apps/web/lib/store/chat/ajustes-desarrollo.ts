/**
 * Ajustes del chat cuando no hay base de datos (desarrollo con datos de ejemplo): encendido y con el proveedor de prueba.
 * En producción nunca se usan: `usarSupabase()` es siempre verdadero y los ajustes salen de `chat_settings`.
 */
import type { AjustesChat } from './fuente-supabase';

export const AJUSTES_DESARROLLO: AjustesChat = {
  habilitado: true,
  modeloPrimario: 'mock',
  modeloRespaldo: null,
  presupuestoMicros: 10_000_000n,
  degradarPct: 80,
  instruccionesExtra: null,
  bienvenida: {
    CO: 'Hola, soy Iza, tu asesora de Izao. Cuéntame para quién es el perfume y te muestro opciones.',
    EC: 'Hola, soy Iza, tu asesora de Izao. Cuéntame para quién es el perfume y te muestro opciones.',
  },
  maxTokens: 450,
  turnos: 12,
  maxEntrada: 500,
  maxMensajesSesion: 30,
};
