import { describe, expect, it, vi } from 'vitest';
import { conversar, type DepsConversar, type EntradaTurno, type EventoChat } from './conversar';
import type { DepsHerramientas } from './herramientas';
import { ErrorProveedor, describirFallo, limpiarDetalle, type EventoLLM, type LLMProvider, type SolicitudLLM } from './llm';
import { URL_OPENROUTER, crearOpenRouter, eventosDeStream, leerErrorHttp } from './openrouter';
import { TI } from './textos';

const recoger = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};
const fin = (): EventoLLM => ({ tipo: 'fin', uso: { tokensIn: 100, tokensOut: 20, costoMicros: 1000n } });

function guionado(guiones: (EventoLLM[] | Error)[]): LLMProvider & { llamadas: SolicitudLLM[] } {
  const llamadas: SolicitudLLM[] = [];
  return {
    nombre: 'guion',
    llamadas,
    async *completar(s) {
      llamadas.push(s);
      const g = guiones[Math.min(llamadas.length - 1, guiones.length - 1)]!;
      if (g instanceof Error) throw g;
      yield* g;
    },
  };
}

function armar(proveedor: LLMProvider) {
  const registrar = vi.fn(async () => undefined);
  const fallo = vi.fn();
  const deps: DepsConversar = {
    proveedor,
    herramientas: {} as DepsHerramientas,
    tarjeta: async () => null,
    precios: { entradaMicrosPorMtok: 1_000_000n, salidaMicrosPorMtok: 4_000_000n },
    registrar,
    fallo,
  };
  const entrada: EntradaTurno = {
    nivel: 'normal',
    modeloPrimario: 'modelo-a',
    modeloRespaldo: 'modelo-b',
    maxTokens: 450,
    contexto: { nombrePais: 'Colombia', moneda: 'COP' },
    historial: [],
    mensaje: 'Quiero algo fresco',
  };
  return { deps, entrada, registrar, fallo };
}

describe('fallo del proveedor: registro y respaldo', () => {
  it.each([429, 500, 502, 503, 404, 402])('con %i usa el modelo de respaldo y registra el fallo del primario', async (estado) => {
    const prov = guionado([new ErrorProveedor(`OpenRouter respondió ${estado}.`, estado, String(estado), 'Provider returned error'), [{ tipo: 'texto', delta: 'Aquí estoy' }, fin()]]);
    const { deps, entrada, fallo } = armar(prov);
    const ev = await recoger(conversar(deps, entrada));
    expect(prov.llamadas.map((l) => l.modelo)).toEqual(['modelo-a', 'modelo-b']);
    expect(ev.at(-1)).toEqual({ tipo: 'fin' });
    expect(fallo).toHaveBeenCalledWith({ modelo: 'modelo-a', estado, codigo: String(estado), detalle: 'Provider returned error', reintenta: true });
  });

  it('con 401 o 403 (llave inválida) no gasta una segunda llamada, registra y avisa', async () => {
    const prov = guionado([new ErrorProveedor('OpenRouter respondió 401.', 401, '401', 'User not found.')]);
    const { deps, entrada, fallo, registrar } = armar(prov);
    const ev: EventoChat[] = await recoger(conversar(deps, entrada));
    expect(prov.llamadas).toHaveLength(1);
    expect(ev.at(-1)).toEqual({ tipo: 'error', codigo: 'proveedor' });
    expect(fallo).toHaveBeenCalledWith(expect.objectContaining({ modelo: 'modelo-a', estado: 401, reintenta: false }));
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it('si fallan los dos modelos registra los dos fallos, cada uno con su modelo', async () => {
    const prov = guionado([new ErrorProveedor('x', 429, '429', 'rate-limited upstream'), new ErrorProveedor('y', 404, '404', 'No endpoints found matching your data policy')]);
    const { deps, entrada, fallo } = armar(prov);
    const ev = await recoger(conversar(deps, entrada));
    expect(ev.at(-1)).toEqual({ tipo: 'error', codigo: 'proveedor' });
    expect(fallo).toHaveBeenCalledTimes(2);
    expect(fallo.mock.calls.map((c) => [(c[0] as { modelo: string }).modelo, (c[0] as { estado: number }).estado, (c[0] as { reintenta: boolean }).reintenta])).toEqual([
      ['modelo-a', 429, true],
      ['modelo-b', 404, false],
    ]);
  });

  it('un error genérico (red) se registra sin estado y con respaldo', async () => {
    const prov = guionado([new TypeError('fetch failed'), [{ tipo: 'texto', delta: 'Hola' }, fin()]]);
    const { deps, entrada, fallo } = armar(prov);
    await recoger(conversar(deps, entrada));
    expect(fallo).toHaveBeenCalledWith({ modelo: 'modelo-a', estado: null, codigo: null, detalle: 'fetch failed', reintenta: true });
  });
});

describe('OpenRouter: error HTTP', () => {
  const respuesta = (status: number, cuerpo: string) => new Response(cuerpo, { status });

  it('toma el código y el mensaje corto del error de OpenRouter, sin el cuerpo entero', async () => {
    const e = await leerErrorHttp(respuesta(404, JSON.stringify({ error: { code: 404, message: 'No endpoints found matching your data policy (Free model publication).', metadata: { raw: 'prompt secreto del cliente' } } })));
    expect(e.estado).toBe(404);
    expect(e.codigo).toBe('404');
    expect(e.detalle).toBe('No endpoints found matching your data policy (Free model publication).');
    expect(JSON.stringify(describirFallo(e))).not.toContain('prompt secreto');
  });

  it('con un cuerpo que no es JSON queda solo el estado', async () => {
    const e = await leerErrorHttp(respuesta(502, '<html>Bad gateway</html>'));
    expect(e).toMatchObject({ estado: 502, codigo: null, detalle: null });
  });

  it('limpia llaves y tokens del mensaje y lo recorta a 200 caracteres', () => {
    expect(limpiarDetalle('Invalid key sk-or-v1-abcdef1234567890 y Bearer abc.def')).toBe('Invalid key [oculto] y Bearer [oculto]');
    expect(limpiarDetalle('a'.repeat(500))).toHaveLength(200);
    expect(limpiarDetalle(undefined)).toBeNull();
  });

  it('el adaptador lanza ErrorProveedor con el estado y el detalle cuando la respuesta no es 2xx', async () => {
    const fetchFn = vi.fn(async () => respuesta(429, JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } })));
    const prov = crearOpenRouter({ apiKey: 'sk-or-v1-no-real', fetchFn: fetchFn as unknown as typeof fetch });
    const err = await recoger(prov.completar({ modelo: 'm:free', mensajes: [{ role: 'user', content: 'hola' }], herramientas: [], maxTokens: 10 })).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ErrorProveedor);
    expect(describirFallo(err)).toEqual({ estado: 429, codigo: '429', detalle: 'Rate limit exceeded: free-models-per-day' });
    expect(JSON.stringify(describirFallo(err))).not.toContain('sk-or');
  });

  it('un chunk de error dentro del stream conserva código y mensaje', async () => {
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"error":{"code":"server_error","message":"Provider disconnected"}}\n\n'));
        c.close();
      },
    });
    const err = await recoger(eventosDeStream(cuerpo)).catch((x: unknown) => x);
    expect(describirFallo(err)).toEqual({ estado: null, codigo: 'server_error', detalle: 'Provider disconnected' });
  });

  it('la política de datos se pide como deny por defecto y se puede cambiar a allow', async () => {
    const cuerpos: { provider: { data_collection: string } }[] = [];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      cuerpos.push(JSON.parse(String(init?.body)) as { provider: { data_collection: string } });
      return respuesta(500, '');
    });
    const solicitud = { modelo: 'm', mensajes: [{ role: 'user' as const, content: 'hola' }], herramientas: [], maxTokens: 10 };
    await recoger(crearOpenRouter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch }).completar(solicitud)).catch(() => undefined);
    await recoger(crearOpenRouter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, recoleccionDatos: 'allow' }).completar(solicitud)).catch(() => undefined);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(URL_OPENROUTER);
    expect(cuerpos.map((c) => c.provider.data_collection)).toEqual(['deny', 'allow']);
  });
});

describe('textos del fallo', () => {
  it('Iza descansa y no afirma nada de originalidad ni marcas', () => {
    expect(TI.estados.proveedor).toContain('descansando');
    expect(TI.estados.proveedor).toContain('WhatsApp');
    expect(TI.estados.proveedorSinAsesor).not.toContain('WhatsApp');
  });
});
