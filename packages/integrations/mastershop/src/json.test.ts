import { describe, expect, it } from 'vitest';
import { serializeMasterShopJson } from './json';

describe('serializeMasterShopJson', () => {
  it('escribe bigint COP como entero sin comillas', () => {
    expect(serializeMasterShopJson({ total: 80_000n, v: -25_000n })).toBe(
      '{"total":80000,"v":-25000}',
    );
  });

  it('escribe USD con dos decimales exactos', () => {
    expect(serializeMasterShopJson({ total: 8_982n, c: 5n }, 'USD')).toBe(
      '{"total":89.82,"c":0.05}',
    );
  });

  it('un texto que imita el marcador sigue siendo texto', () => {
    const json = serializeMasterShopJson({ note: '__ms_x_5__', total: 1n });
    expect(JSON.parse(json)).toEqual({ note: '__ms_x_5__', total: 1 });
  });

  it('conserva null y números normales', () => {
    expect(serializeMasterShopJson({ zip: null, weight: 0.5 })).toBe('{"zip":null,"weight":0.5}');
  });
});
