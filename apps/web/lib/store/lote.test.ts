import { describe, expect, it } from 'vitest';
import { cargarInicial } from './listado-servidor';
import {
  combinarFijos,
  extremosControl,
  fusionar,
  hrefListado,
  leerInstantanea,
  normalizarRango,
  parametrosApi,
  quitarFijos,
  saltosParaPagina,
  serializarInstantanea,
} from './lote';
import type { ConsultaCatalogo } from './repo';
import type { ItemCatalogo, PaginaCatalogo } from './types';

const item = (n: number): ItemCatalogo =>
  ({ product_id: `id-${n}`, slug: `perfume-${n}`, name: `Perfume ${n}`, min_price: 1000 * n }) as ItemCatalogo;

describe('filtros fijos de la ruta', () => {
  it('los fijos mandan y no salen en la URL visible', () => {
    const fijos = { category: 'arabes' };
    expect(combinarFijos({ category: 'otra', gender: 'mujer' }, fijos)).toEqual({ category: 'arabes', gender: 'mujer' });
    expect(quitarFijos({ category: 'arabes', gender: 'mujer' }, fijos)).toEqual({ gender: 'mujer' });
    expect(hrefListado('/co/categoria/arabes', { filtros: { category: 'arabes', gender: 'mujer' }, orden: 'price_asc' }, fijos)).toBe(
      '/co/categoria/arabes?genero=mujer&orden=price_asc',
    );
    expect(hrefListado('/co/catalogo', { filtros: {}, orden: 'featured' }, {})).toBe('/co/catalogo');
    expect(hrefListado('/co/catalogo', { filtros: {}, orden: 'featured' }, {}, 3)).toBe('/co/catalogo?page=3');
  });

  it('la API recibe país, filtros fijos, orden y cursor, y nunca offset ni page', () => {
    const p = parametrosApi('ec', { q: '', filtros: { brands: ['a', 'b'] }, orden: 'newest' }, { collection: 'nuevos' }, 'abc');
    expect(p.get('country')).toBe('ec');
    expect(p.get('marca')).toBe('a,b');
    expect(p.get('coleccion')).toBe('nuevos');
    expect(p.get('orden')).toBe('newest');
    expect(p.get('cursor')).toBe('abc');
    expect(p.has('offset')).toBe(false);
    expect(p.has('page')).toBe(false);
  });
});

describe('fusionar lotes', () => {
  it('conserva el orden y descarta repetidos', () => {
    const r = fusionar([item(1), item(2)], [item(2), item(3), item(3)]);
    expect(r.map((i) => i.product_id)).toEqual(['id-1', 'id-2', 'id-3']);
  });
});

describe('saltos para ?page=N sin OFFSET', () => {
  it('página 1 no salta; después, de a 100 como máximo', () => {
    expect(saltosParaPagina(1)).toEqual([]);
    expect(saltosParaPagina(2)).toEqual([25]);
    expect(saltosParaPagina(5)).toEqual([100]);
    expect(saltosParaPagina(6)).toEqual([100, 25]);
    expect(saltosParaPagina(17)).toEqual([100, 100, 100, 100]);
  });

  it('cargarInicial encadena los cursores y devuelve la página pedida', async () => {
    const llamadas: ConsultaCatalogo[] = [];
    const repo = {
      async catalogo(_p: unknown, c: ConsultaCatalogo): Promise<PaginaCatalogo> {
        llamadas.push(c);
        const desde = c.cursor ? Number(c.cursor.v) : 0;
        const items = Array.from({ length: c.limite }, (_, i) => item(desde + i));
        const hasta = desde + c.limite;
        return { items, next_cursor: hasta < 400 ? { o: 'featured', s: 0, v: String(hasta), id: `id-${hasta}` } : null, total_estimado: 400, precio_min: 1, precio_max: 9 };
      },
    };
    const r = await cargarInicial(repo, 'co', { q: '', filtros: {}, orden: 'featured' }, { category: 'hombre' }, 7);
    expect(llamadas.map((l) => l.limite)).toEqual([100, 50, 25]);
    expect(llamadas.every((l) => l.filtros.category === 'hombre')).toBe(true);
    expect(r.items[0]?.product_id).toBe('id-150');
    expect(r.items).toHaveLength(25);
    expect(r.nextCursor).not.toBeNull();
    expect(r.total).toBe(400);
    expect(r.fueraDeRango).toBe(false);
  });

  it('una página más allá del final queda marcada fuera de rango', async () => {
    const repo = {
      async catalogo(): Promise<PaginaCatalogo> {
        return { items: [item(1)], next_cursor: null, total_estimado: 1, precio_min: 1, precio_max: 1 };
      },
    };
    const r = await cargarInicial(repo, 'co', { q: '', filtros: {}, orden: 'featured' }, {}, 5);
    expect(r.fueraDeRango).toBe(true);
    expect(r.items).toHaveLength(0);
  });
});

describe('instantánea para volver desde la ficha', () => {
  const base = { items: [item(1), item(2)], nextCursor: 'xyz', total: 400, scrollY: 1234, guardado: 1_000_000 };

  it('ida y vuelta', () => {
    const r = leerInstantanea(serializarInstantanea(base), 1_000_000 + 5000);
    expect(r?.items).toHaveLength(2);
    expect(r?.scrollY).toBe(1234);
    expect(r?.nextCursor).toBe('xyz');
  });

  it('rechaza lo vencido, lo vacío y lo mal formado', () => {
    expect(leerInstantanea(serializarInstantanea(base), 1_000_000 + 31 * 60 * 1000)).toBeNull();
    expect(leerInstantanea(serializarInstantanea({ ...base, items: [] }), 1_000_001)).toBeNull();
    expect(leerInstantanea('{', 1)).toBeNull();
    expect(leerInstantanea(null, 1)).toBeNull();
    expect(leerInstantanea(JSON.stringify({ v: 1, items: [{ nada: 1 }], guardado: 1, scrollY: 0, nextCursor: null, total: null }), 2)).toBeNull();
    expect(leerInstantanea(serializarInstantanea({ ...base, scrollY: -5 }), 1_000_001)).toBeNull();
  });
});

describe('rango de precio', () => {
  const lim = { min: 55_500, max: 1_234_000 };

  it('los extremos reales no son filtro', () => {
    expect(normalizarRango({}, lim, 1000)).toEqual({});
    expect(normalizarRango({ min: 55_000, max: 1_234_000 }, lim, 1000)).toEqual({});
  });

  it('un tramo interior se conserva y se acota a los límites', () => {
    expect(normalizarRango({ min: 100_000, max: 400_000 }, lim, 1000)).toEqual({ price_min: 100_000, price_max: 400_000 });
    expect(normalizarRango({ min: 10, max: 99_999_999 }, lim, 1000)).toEqual({});
  });

  it('si min supera a max los intercambia', () => {
    expect(normalizarRango({ min: 500_000, max: 200_000 }, lim, 1000)).toEqual({ price_min: 200_000, price_max: 500_000 });
  });

  it('los extremos del control salen del filtro o de los límites', () => {
    expect(extremosControl({}, lim, 1000)).toEqual({ piso: 55_000, techo: 1_234_000, min: 55_000, max: 1_234_000 });
    expect(extremosControl({ price_min: 200_000 }, lim, 1000).min).toBe(200_000);
    expect(extremosControl({}, { min: 0, max: 0 }, 1000).techo).toBe(1000);
  });
});
