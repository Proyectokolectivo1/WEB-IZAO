import { describe, expect, it } from 'vitest';
import { CACHE_CATALOGO, etagDe, jsonCacheable } from './http-cache';

const pedir = (h: Record<string, string> = {}) => new Request('http://localhost/api/catalog', { headers: h });

describe('jsonCacheable', () => {
  it('responde 200 con ETag, Cache-Control y JSON', async () => {
    const r = jsonCacheable(pedir(), { items: [1, 2] }, CACHE_CATALOGO.listado);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(CACHE_CATALOGO.listado);
    expect(r.headers.get('etag')).toBe(etagDe('{"items":[1,2]}'));
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toEqual({ items: [1, 2] });
  });
  it('responde 304 sin cuerpo si la etiqueta coincide (también débil o entre varias)', async () => {
    const etag = etagDe('{"a":1}');
    for (const valor of [etag, etag.replace('W/', ''), `"otra", ${etag}`, '*']) {
      const r = jsonCacheable(pedir({ 'if-none-match': valor }), { a: 1 }, CACHE_CATALOGO.ficha);
      expect(r.status, valor).toBe(304);
      expect(r.headers.get('etag')).toBe(etag);
      expect(await r.text()).toBe('');
    }
  });
  it('si el contenido cambió, vuelve a enviarlo', () => {
    const r = jsonCacheable(pedir({ 'if-none-match': etagDe('{"a":1}') }), { a: 2 }, CACHE_CATALOGO.ficha);
    expect(r.status).toBe(200);
  });
});
