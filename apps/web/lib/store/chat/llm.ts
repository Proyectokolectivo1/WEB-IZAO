/**
 * Contrato del proveedor de modelos (§20.2). El chat solo conoce `LLMProvider`: OpenRouter es una implementación
 * (`openrouter.ts`) y `mock.ts` responde sin red cuando el panel aún no tiene credencial. Código puro (sin servidor).
 */

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  /** JSON tal como lo escribió el modelo (puede venir mal formado: lo valida cada herramienta). */
  argumentos: string;
}

export type MensajeLLM =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; llamadas?: LlamadaHerramienta[] }
  | { role: 'tool'; llamadaId: string; content: string };

/** Un turno ya guardado de la conversación (lo que se reenvía como historial). */
export interface TurnoGuardado {
  role: 'user' | 'assistant';
  content: string;
}

export interface DefHerramienta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface UsoLLM {
  tokensIn: number;
  tokensOut: number;
  /** Costo informado por el proveedor en micro-USD; `null` si no lo informó (se estima por tokens). */
  costoMicros: bigint | null;
}

export type EventoLLM =
  | { tipo: 'texto'; delta: string }
  | { tipo: 'herramientas'; llamadas: LlamadaHerramienta[] }
  | { tipo: 'fin'; uso: UsoLLM };

export interface SolicitudLLM {
  modelo: string;
  mensajes: MensajeLLM[];
  herramientas: DefHerramienta[];
  maxTokens: number;
  senal?: AbortSignal;
}

export interface LLMProvider {
  nombre: string;
  /** Emite `texto` en vivo; al terminar, `herramientas` (si el modelo pidió llamadas) y siempre un `fin` con el uso. */
  completar(solicitud: SolicitudLLM): AsyncIterable<EventoLLM>;
}

export class ErrorProveedor extends Error {
  constructor(
    mensaje: string,
    readonly estado: number | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorProveedor';
  }
}
