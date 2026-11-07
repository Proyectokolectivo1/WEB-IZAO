import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorHttp, estadisticas, olvidar, pedirJson, reiniciarFetcher } from './fetcher';

function respuesta(cuerpo: unknown, ok = true, estado = 200) {
  return { ok, status: estado, json: () => Promise.resolve(cuerpo) } as unknown as Response;
}

describe('pedirJson', () => {
  beforeEach(() => {
    reiniciarFetcher();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('comparte una sola petición entre llamadas con la misma clave en vuelo', async () => {
    const f = vi.fn(() => Promise.resolve(respuesta({ a: 1 })));
    vi.stubGlobal('fetch', f);
    const [x, y] = await Promise.all([pedirJson('/api/x'), pedirJson('/api/x')]);
    expect(x).toEqual({ a: 1 });
    expect(y).toBe(x);
    expect(f).toHaveBeenCalledTimes(1);
    expect(estadisticas.compartidas).toBe(1);
  });

  it('sin vigencia no recuerda: la segunda llamada, ya resuelta la primera, vuelve a pedir', async () => {
    const f = vi.fn(() => Promise.resolve(respuesta({ a: 1 })));
    vi.stubGlobal('fetch', f);
    await pedirJson('/api/x');
    await pedirJson('/api/x');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('con vigencia sirve de memoria y luego renueva', async () => {
    const f = vi.fn(() => Promise.resolve(respuesta({ a: 1 })));
    vi.stubGlobal('fetch', f);
    await pedirJson('/api/x', { vigenteMs: 1000 });
    await pedirJson('/api/x', { vigenteMs: 1000 });
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    await pedirJson('/api/x', { vigenteMs: 1000 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('revalida en segundo plano dentro de la ventana obsoleta y responde lo guardado', async () => {
    let n = 0;
    const f = vi.fn(() => Promise.resolve(respuesta({ n: ++n })));
    vi.stubGlobal('fetch', f);
    expect(await pedirJson('/api/x', { vigenteMs: 1000, obsoletoMs: 5000 })).toEqual({ n: 1 });
    vi.advanceTimersByTime(2000);
    expect(await pedirJson('/api/x', { vigenteMs: 1000, obsoletoMs: 5000 })).toEqual({ n: 1 });
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pedirJson('/api/x', { vigenteMs: 1000, obsoletoMs: 5000 })).toEqual({ n: 2 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('no guarda fallos y los rechaza con ErrorHttp', async () => {
    const f = vi.fn().mockResolvedValueOnce(respuesta({}, false, 500)).mockResolvedValueOnce(respuesta({ ok: 1 }));
    vi.stubGlobal('fetch', f);
    await expect(pedirJson('/api/x', { vigenteMs: 1000 })).rejects.toBeInstanceOf(ErrorHttp);
    expect(await pedirJson('/api/x', { vigenteMs: 1000 })).toEqual({ ok: 1 });
  });

  it('cancelar a un suscriptor no corta a los demás; cancelar a todos aborta la petición real', async () => {
    let senalReal: AbortSignal | undefined;
    let resolver: (r: Response) => void = () => undefined;
    const f = vi.fn((_u: string, init?: RequestInit) => {
      senalReal = init?.signal ?? undefined;
      return new Promise<Response>((res) => (resolver = res));
    });
    vi.stubGlobal('fetch', f);
    const a = new AbortController();
    const b = new AbortController();
    const pa = pedirJson('/api/x', { signal: a.signal });
    const pb = pedirJson('/api/x', { signal: b.signal });
    a.abort();
    await expect(pa).rejects.toMatchObject({ name: 'AbortError' });
    expect(senalReal?.aborted).toBe(false);
    resolver(respuesta({ v: 1 }));
    expect(await pb).toEqual({ v: 1 });

    const c = new AbortController();
    const pc = pedirJson('/api/y', { signal: c.signal });
    c.abort();
    await expect(pc).rejects.toMatchObject({ name: 'AbortError' });
    expect(senalReal?.aborted).toBe(true);
  });

  it('una señal ya cancelada rechaza sin dejar la petición colgada', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const c = new AbortController();
    c.abort();
    await expect(pedirJson('/api/z', { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('POST: la clave incluye el cuerpo', async () => {
    const f = vi.fn(() => Promise.resolve(respuesta({ a: 1 })));
    vi.stubGlobal('fetch', f);
    await Promise.all([
      pedirJson('/api/p', { init: { method: 'POST', body: '{"a":1}' } }),
      pedirJson('/api/p', { init: { method: 'POST', body: '{"a":1}' } }),
      pedirJson('/api/p', { init: { method: 'POST', body: '{"a":2}' } }),
    ]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('olvidar borra por fragmento', async () => {
    const f = vi.fn(() => Promise.resolve(respuesta({ a: 1 })));
    vi.stubGlobal('fetch', f);
    await pedirJson('/api/catalog?x=1', { vigenteMs: 1000 });
    olvidar('/api/catalog');
    await pedirJson('/api/catalog?x=1', { vigenteMs: 1000 });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
