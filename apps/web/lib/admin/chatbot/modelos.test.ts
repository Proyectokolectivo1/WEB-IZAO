import { describe, expect, it, vi } from 'vitest';
import { leerModelos, modelosOpenRouter, URL_MODELOS_OPENROUTER } from './modelos';

const respuesta = (cuerpo: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;

describe('leerModelos', () => {
  it('toma id y nombre, ordena, quita repetidos y descarta lo que no tiene la forma esperada', () => {
    const r = leerModelos({
      data: [
        { id: 'openai/gpt-x', name: 'GPT X', pricing: { prompt: '0.00003' } },
        { id: 'anthropic/claude-y:free', name: 'Claude Y' },
        { id: 'openai/gpt-x', name: 'Repetido' },
        { id: 'sin barra' },
        { id: 7 },
        null,
        { id: 'meta/llama', name: 5 },
      ],
    });
    expect(r).toEqual([
      { id: 'anthropic/claude-y:free', nombre: 'Claude Y' },
      { id: 'meta/llama', nombre: 'meta/llama' },
      { id: 'openai/gpt-x', nombre: 'GPT X' },
    ]);
    expect(leerModelos(null)).toEqual([]);
    expect(leerModelos({ data: 'no' })).toEqual([]);
  });
});

describe('modelosOpenRouter', () => {
  it('pide el listado público, devuelve las sugerencias y no manda ninguna llave', async () => {
    const f = respuesta({ data: [{ id: 'a/b', name: 'AB' }] });
    expect(await modelosOpenRouter({ fetchImpl: f, cache: { almacen: null } })).toEqual([{ id: 'a/b', nombre: 'AB' }]);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_MODELOS_OPENROUTER);
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
  });

  it('si OpenRouter falla o no responde, devuelve lista vacía (el campo queda de texto libre)', async () => {
    expect(await modelosOpenRouter({ fetchImpl: respuesta({}, 500), cache: { almacen: null } })).toEqual([]);
    const caido = vi.fn(async () => {
      throw new TypeError('red');
    }) as unknown as typeof fetch;
    expect(await modelosOpenRouter({ fetchImpl: caido, cache: { almacen: null } })).toEqual([]);
  });
});
