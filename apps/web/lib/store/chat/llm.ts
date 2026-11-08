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
    /** Código corto del error del proveedor (p. ej. `429`, `rate_limit`); nunca el cuerpo completo. */
    readonly codigo: string | null = null,
    /** Mensaje corto del proveedor, ya recortado y sin secretos, solo para el registro del servidor. */
    readonly detalle: string | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorProveedor';
  }
}

export interface FalloProveedor {
  estado: number | null;
  codigo: string | null;
  detalle: string | null;
}

/** Recorta y limpia un texto del proveedor para el registro: una línea, sin llaves ni tokens, máximo 200 caracteres. */
export function limpiarDetalle(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null;
  const t = crudo
    .replace(/\s+/g, ' ')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[oculto]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [oculto]')
    .trim();
  return t ? t.slice(0, 200) : null;
}

/** Datos seguros de cualquier error para registrar (estado HTTP, código y mensaje corto; nada más). */
export function describirFallo(err: unknown): FalloProveedor {
  if (err instanceof ErrorProveedor) return { estado: err.estado, codigo: err.codigo, detalle: err.detalle ?? limpiarDetalle(err.message) };
  if (err instanceof Error) return { estado: null, codigo: err.name === 'AbortError' ? 'abortado' : null, detalle: limpiarDetalle(err.name === 'AbortError' ? 'solicitud abortada' : err.message) };
  return { estado: null, codigo: null, detalle: null };
}
