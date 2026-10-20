import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaCategoria } from './categorias';
import { eliminarCategoriaBd, guardarCategoriaBd } from './categorias-servidor';

const comun = { actor: 'u1', ip: null };
const base = { name: 'Árabes', slug: 'arabes', visible_CO: 'on', orden_CO: '1', visible_EC: '', orden_EC: '0' };

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('guardarCategoriaBd', () => {
  it('crea la categoría y escribe la visibilidad de ambos países', async () => {
    const { cliente, llamadas } = clienteFalso({ 'categories.insert': { data: { id: 'c1' } } });
    const r = await guardarCategoriaBd({ cliente, datos: esquemaCategoria.parse(base), ...comun });
    expect(r).toEqual({ ok: true, id: 'c1' });
    const filas = llamadas.find((l) => l.clave === 'category_countries.upsert')?.args[0] as { country_code: string; is_visible: boolean }[];
    expect(filas).toEqual([
      { category_id: 'c1', country_code: 'CO', is_visible: true, sort_order: 1 },
      { category_id: 'c1', country_code: 'EC', is_visible: false, sort_order: 0 },
    ]);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'categories.creado', entidadId: 'c1' }));
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
  });

  it('rechaza un tercer nivel sin escribir nada', async () => {
    const padre = '22222222-2222-4222-8222-222222222222';
    const { cliente, llamadas } = clienteFalso({ 'categories.select': { data: { id: padre, parent_id: 'abuelo' } } });
    const r = await guardarCategoriaBd({ cliente, datos: esquemaCategoria.parse({ ...base, parent_id: padre }), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { parent_id: expect.stringContaining('2 niveles') } });
    expect(llamadas.some((l) => l.clave.endsWith('.insert') || l.clave.endsWith('.update'))).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('un slug repetido es error de campo', async () => {
    const { cliente } = clienteFalso({ 'categories.insert': { error: { code: '23505', message: 'categories_slug_key slug' } } });
    const r = await guardarCategoriaBd({ cliente, datos: esquemaCategoria.parse(base), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { slug: expect.any(String) } });
  });
});

describe('eliminarCategoriaBd', () => {
  it('no elimina si tiene productos', async () => {
    const { cliente, llamadas } = clienteFalso({ 'product_categories.select': { count: 4 } });
    const r = await eliminarCategoriaBd({ cliente, id: 'c1', ...comun });
    expect(r).toMatchObject({ ok: false });
    expect(llamadas.some((l) => l.clave === 'categories.delete')).toBe(false);
  });
  it('no elimina si un banner la usa (se borraría en cascada)', async () => {
    const { cliente } = clienteFalso({ 'banners.select': { count: 1 } });
    const r = await eliminarCategoriaBd({ cliente, id: 'c1', ...comun });
    expect(r).toMatchObject({ ok: false });
  });
  it('elimina y audita el antes cuando está libre', async () => {
    const { cliente } = clienteFalso({ 'categories.select': { data: { id: 'c1' }, count: 0 } });
    const r = await eliminarCategoriaBd({ cliente, id: 'c1', ...comun });
    expect(r.ok).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'categories.eliminado' }));
  });
});
