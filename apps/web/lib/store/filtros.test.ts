import { describe, expect, it } from 'vitest';
import {
  aFiltrosRpc,
  aParametros,
  codificarCursor,
  contarFiltros,
  decodificarCursor,
  parsearEstado,
} from './filtros';

describe('estado del listado en la URL', () => {
  it('sin parámetros: destacados y sin filtros', () => {
    const e = parsearEstado(new URLSearchParams(''));
    expect(e.orden).toBe('featured');
    expect(e.filtros).toEqual({});
    expect(e.pagina).toBe(1);
  });

  it('ida y vuelta de todos los filtros', () => {
    const entrada = new URLSearchParams(
      'genero=mujer&marca=a-b,c&familia=floral&concentracion=edp&categoria=arabes&disponible=1&precio_min=50000&precio_max=250000&orden=price_asc',
    );
    const e = parsearEstado(entrada);
    expect(e.filtros.brands).toEqual(['a-b', 'c']);
    expect(e.orden).toBe('price_asc');
    expect(parsearEstado(aParametros(e))).toEqual(e);
    expect(contarFiltros(e.filtros)).toBe(8);
  });

  it('descarta slugs peligrosos, montos no enteros y órdenes desconocidos', () => {
    const e = parsearEstado(new URLSearchParams("genero=mujer';drop&precio_min=12.5&precio_max=-3&orden=hack&marca=ok,%20,BAD!"));
    expect(e.filtros.gender).toBeUndefined();
    expect(e.filtros.price_min).toBeUndefined();
    expect(e.filtros.price_max).toBeUndefined();
    expect(e.orden).toBe('featured');
    expect(e.filtros.brands).toEqual(['ok']);
  });

  it('intercambia precio mínimo y máximo invertidos', () => {
    const e = parsearEstado({ precio_min: '900', precio_max: '100' });
    expect(e.filtros).toMatchObject({ price_min: 100, price_max: 900 });
  });

  it('con búsqueda el orden por defecto es relevancia y no se escribe en la URL', () => {
    const e = parsearEstado({ q: '  aroma   dulce ' });
    expect(e.q).toBe('aroma dulce');
    expect(e.orden).toBe('relevance');
    expect(aParametros(e).toString()).toBe('q=aroma+dulce');
    expect(parsearEstado({ orden: 'relevance' }).orden).toBe('featured');
  });

  it('arma los filtros del RPC', () => {
    expect(aFiltrosRpc({ gender: 'mujer', availability: 'in_stock', price_max: 10 })).toEqual({
      gender: 'mujer',
      availability: 'in_stock',
      price_max: 10,
    });
  });
});

describe('cursor', () => {
  const cursor = { o: 'featured', s: 1, v: '1205', id: '0f8b2c1e-aaaa-bbbb-cccc-1234567890ab' };

  it('ida y vuelta, también con tildes', () => {
    const c = codificarCursor({ ...cursor, v: 'Ámbar' })!;
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificarCursor(c)).toEqual({ ...cursor, v: 'Ámbar' });
  });

  it('rechaza basura, objetos incompletos y textos enormes', () => {
    expect(decodificarCursor('!!!')).toBeNull();
    expect(decodificarCursor(codificarCursor({ o: 'x' }))).toBeNull();
    expect(decodificarCursor('a'.repeat(600))).toBeNull();
    expect(decodificarCursor(null)).toBeNull();
    expect(codificarCursor(null)).toBeNull();
  });
});
