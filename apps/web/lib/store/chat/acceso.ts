/**
 * Decisión de acceso de un mensaje al chat (§20.4, §20.5), antes de gastar nada. Código puro: ajustes, consumo y sesión
 * entran como datos y sale un veredicto con el estado que el widget sabe mostrar.
 */
import { nivelPresupuesto, type NivelPresupuesto } from './presupuesto';

export type EstadoChat = 'desactivado' | 'agotado' | 'entrada_larga' | 'entrada_vacia' | 'sesion_llena';

export interface EntradaAcceso {
  habilitado: boolean;
  presupuestoMicros: bigint;
  gastadoMicros: bigint;
  degradarPct: number;
  mensaje: string;
  maxEntrada: number;
  /** Mensajes ya enviados en la sesión (0 si es nueva) y tope por sesión. */
  mensajesSesion: number;
  maxMensajesSesion: number;
}

export type VeredictoAcceso = { ok: true; nivel: Exclude<NivelPresupuesto, 'agotado'> } | { ok: false; estado: EstadoChat; status: number };

/** Quita caracteres de control y espacios sobrantes; el recorte de longitud lo decide `decidirAcceso`. */
export function limpiarMensaje(crudo: string): string {
  const sinControl = [...crudo.normalize('NFKC')]
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n >= 32 ? n !== 127 : n === 9 || n === 10 || n === 13;
    })
    .join('');
  return sinControl.split('	').join(' ').replace(/ {2,}/g, ' ').trim();
}

export function decidirAcceso(e: EntradaAcceso): VeredictoAcceso {
  if (!e.habilitado) return { ok: false, estado: 'desactivado', status: 503 };
  const nivel = nivelPresupuesto({ gastado: e.gastadoMicros, presupuesto: e.presupuestoMicros, degradarPct: e.degradarPct });
  if (nivel === 'agotado') return { ok: false, estado: 'agotado', status: 200 };
  if (e.mensaje.length === 0) return { ok: false, estado: 'entrada_vacia', status: 400 };
  if (e.mensaje.length > e.maxEntrada) return { ok: false, estado: 'entrada_larga', status: 400 };
  if (e.mensajesSesion >= e.maxMensajesSesion) return { ok: false, estado: 'sesion_llena', status: 429 };
  return { ok: true, nivel };
}
