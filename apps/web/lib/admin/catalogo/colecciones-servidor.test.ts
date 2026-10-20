import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaColeccion } from './colecciones';
import {
  agregarItemBd,
  destacarBd,
  guardarColeccionBd,
  moverItemBd,
} from './colecciones-servidor';

const comun = { actor: 'u1', ip: null };

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('colecciones', () => {
  it('crea una colección y solo invalida el país afectado', async () => {
    const { cliente } = clienteFalso({ 'collections.insert': { data: { id: 'c1' } } });
    const datos = esquemaColeccion.parse({ country_code: 'EC', name: 'Nuevos', slug: 'nuevos', type: 'manual' });
    const r = await guardarColeccionBd({ cliente, datos, ...comun });
    expect(r).toEqual({ ok: true, id: 'c1' });
    expect(revalidar).toHaveBeenCalledWith('catalog:EC');
    expect(revalidar).not.toHaveBeenCalledWith('catalog:CO');
  });

  it('no agrega productos a mano a una colección de regla', async () => {
    const { cliente, llamadas } = clienteFalso({ 'collections.select': { data: { country_code: 'CO', type: 'rule' } } });
    const r = await agregarItemBd({ cliente, coleccionId: 'c1', productId: 'p1', ...comun });
    expect(r.ok).toBe(false);
    expect(llamadas.some((l) => l.clave === 'collection_items.upsert')).toBe(false);
  });

  it('agrega al final con posiciones consecutivas', async () => {
    const { cliente, llamadas } = clienteFalso({
      'collections.select': { data: { country_code: 'CO', type: 'manual' } },
      'collection_items.select': { data: [{ product_id: 'a' }, { product_id: 'b' }] },
    });
    const r = await agregarItemBd({ cliente, coleccionId: 'c1', productId: 'p1', ...comun });
    expect(r.ok).toBe(true);
    const filas = llamadas.find((l) => l.clave === 'collection_items.upsert')?.args[0] as { product_id: string; sort_order: number }[];
    expect(filas.map((f) => `${f.product_id}:${f.sort_order}`)).toEqual(['a:1', 'b:2', 'p1:3']);
  });

  it('mover hacia arriba intercambia con el vecino', async () => {
    const { cliente, llamadas } = clienteFalso({
      'collections.select': { data: { country_code: 'CO', type: 'manual' } },
      'collection_items.select': { data: [{ product_id: 'a' }, { product_id: 'b' }] },
    });
    await moverItemBd({ cliente, coleccionId: 'c1', productId: 'b', direccion: 'arriba', ...comun });
    const filas = llamadas.find((l) => l.clave === 'collection_items.upsert')?.args[0] as { product_id: string }[];
    expect(filas.map((f) => f.product_id)).toEqual(['b', 'a']);
  });
});

describe('destacados', () => {
  it('no destaca un producto sin fila en el país', async () => {
    const { cliente, llamadas } = clienteFalso({});
    const r = await destacarBd({ cliente, productId: 'p1', pais: 'CO', ...comun });
    expect(r.ok).toBe(false);
    expect(llamadas.some((l) => l.clave === 'product_countries.update')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('destaca, audita e invalida solo ese país', async () => {
    const { cliente, llamadas } = clienteFalso({ 'product_countries.select': { data: { product_id: 'p1' } } });
    const r = await destacarBd({ cliente, productId: 'p1', pais: 'EC', ...comun });
    expect(r.ok).toBe(true);
    expect(llamadas.find((l) => l.clave === 'product_countries.update')?.args[0]).toEqual({ is_featured: true, featured_rank: 1 });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'destacados.agregado' }));
    expect(revalidar).toHaveBeenCalledTimes(1);
    expect(revalidar).toHaveBeenCalledWith('catalog:EC');
  });
});
