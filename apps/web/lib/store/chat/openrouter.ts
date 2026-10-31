/**
 * Adaptador de OpenRouter (API compatible con OpenAI, §20.2). Verificado contra la documentación (usage accounting y
 * streaming): el costo llega en `usage.cost` (créditos; se toma 1 crédito = 1 USD), una sola vez en el último chunk antes
 * de `[DONE]`, y ese chunk trae un `choice` con `delta` vacío, así que `usage` se detecta por presencia y no por
 * `choices` vacío. No hace falta pedir el uso (`usage: {include}` y `stream_options` están en desuso). Las llamadas a
 * herramientas llegan en `delta.tool_calls` y se acumulan por `index` (o por `id`); `finish_reason = "tool_calls"`.
 * Los comentarios SSE (`: OPENROUTER PROCESSING`) se ignoran y un chunk con `error` corta la respuesta.
 */
import { ErrorProveedor, type EventoLLM, type LLMProvider, type LlamadaHerramienta, type MensajeLLM, type SolicitudLLM } from './llm';

export const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/** Créditos de OpenRouter (USD) → micro-USD, sin float acumulado: se redondea una sola vez. */
export function creditosAMicros(cost: unknown): bigint | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null;
  return BigInt(Math.round(cost * 1_000_000));
}

export function mensajesAOpenAI(mensajes: MensajeLLM[]): unknown[] {
  return mensajes.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.llamadaId, content: m.content };
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content,
        ...(m.llamadas?.length
          ? { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } })) }
          : {}),
      };
    }
    return { role: m.role, content: m.content };
  });
}

interface FragmentoLlamada {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface Chunk {
  error?: { message?: string };
  choices?: { delta?: { content?: string | null; tool_calls?: FragmentoLlamada[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** Convierte el cuerpo SSE de OpenRouter en eventos del chat. Exportado para probarlo sin red. */
export async function* eventosDeStream(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<EventoLLM> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  const llamadas: { id: string; nombre: string; argumentos: string }[] = [];
  let pendiente = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let costo: bigint | null = null;
  let hizoLlamadas = false;

  const acumular = (f: FragmentoLlamada) => {
    let i = typeof f.index === 'number' ? f.index : f.id ? llamadas.findIndex((l) => l.id === f.id) : llamadas.length - 1;
    if (i < 0) i = llamadas.length;
    const actual = (llamadas[i] ??= { id: '', nombre: '', argumentos: '' });
    if (f.id) actual.id = f.id;
    if (f.function?.name) actual.nombre += f.function.name;
    if (f.function?.arguments) actual.argumentos += f.function.arguments;
  };

  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      pendiente += decodificador.decode(value, { stream: true });
      let corte: number;
      while ((corte = pendiente.indexOf('\n')) >= 0) {
        const linea = pendiente.slice(0, corte).replace(/\r$/, '');
        pendiente = pendiente.slice(corte + 1);
        if (!linea.startsWith('data:')) continue; // comentarios y líneas vacías
        const dato = linea.slice(5).trim();
        if (dato === '[DONE]') continue;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(dato) as Chunk;
        } catch {
          continue;
        }
        if (chunk.error) throw new ErrorProveedor('El proveedor cortó la respuesta.');
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield { tipo: 'texto', delta: delta.content };
        for (const f of delta?.tool_calls ?? []) acumular(f);
        if (chunk.choices?.[0]?.finish_reason === 'tool_calls') hizoLlamadas = true;
        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
          tokensOut = chunk.usage.completion_tokens ?? tokensOut;
          costo = creditosAMicros(chunk.usage.cost) ?? costo;
        }
      }
    }
  } finally {
    lector.releaseLock();
  }

  const validas: LlamadaHerramienta[] = llamadas.filter((l) => l.nombre).map((l, k) => ({ id: l.id || `llamada_${k}`, nombre: l.nombre, argumentos: l.argumentos || '{}' }));
  if (validas.length > 0 || hizoLlamadas) yield { tipo: 'herramientas', llamadas: validas };
  yield { tipo: 'fin', uso: { tokensIn, tokensOut, costoMicros: costo } };
}

export interface OpcionesOpenRouter {
  apiKey: string;
  fetchFn?: typeof fetch;
  /** URL del sitio (cabecera `HTTP-Referer`, opcional). */
  sitio?: string;
  titulo?: string;
}

export function crearOpenRouter(o: OpcionesOpenRouter): LLMProvider {
  const llamar = o.fetchFn ?? fetch;
  return {
    nombre: 'openrouter',
    async *completar(s: SolicitudLLM) {
      const respuesta = await llamar(URL_OPENROUTER, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          'Content-Type': 'application/json',
          ...(o.sitio ? { 'HTTP-Referer': o.sitio } : {}),
          ...(o.titulo ? { 'X-Title': o.titulo } : {}),
        },
        body: JSON.stringify({
          model: s.modelo,
          messages: mensajesAOpenAI(s.mensajes),
          tools: s.herramientas.map((h) => ({ type: 'function', function: { name: h.name, description: h.description, parameters: h.parameters } })),
          max_tokens: s.maxTokens,
          temperature: 0.4,
          stream: true,
        }),
        signal: s.senal ?? null,
      });
      // Nunca se devuelve el cuerpo del error: podría repetir partes de la solicitud.
      if (!respuesta.ok || !respuesta.body) throw new ErrorProveedor(`OpenRouter respondió ${respuesta.status}.`, respuesta.status);
      yield* eventosDeStream(respuesta.body);
    },
  };
}
