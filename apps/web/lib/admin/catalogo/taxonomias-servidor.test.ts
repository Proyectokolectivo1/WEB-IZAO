import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { TAXONOMIAS, esquemaTaxonomia } from './taxonomias';
import { eliminarTaxonomiaBd, guardarTaxonomiaBd } from './taxonomias-servidor';

const datos = esquemaTaxonomia.parse({ name: 'Árabe', slug: 'arabe' });
const comun = { actor: 'u1', ip: '1.2.3.4' };

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('guardarTaxonomiaBd', () => {
  it('crea, audita e invalida el catálogo de ambos países', async () => {
    const { cliente, llamadas } = clienteFalso({ 'brands.insert': { data: { id: 'n1' } } });
    const r = await guardarTaxonomiaBd({ cliente, def: TAXONOMIAS.marcas, datos, ...comun });
    expect(r).toEqual({ ok: true, id: 'n1' });
    expect(llamadas.find((l) => l.clave === 'brands.insert')?.args[0]).toMatchObject({ name: 'Árabe', slug: 'arabe' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'brands.creado', entidadId: 'n1', actor: 'u1' }));
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
    expect(revalidar).toHaveBeenCalledWith('catalog:EC');
  });

  it('un slug repetido vuelve como error de campo y no audita ni invalida', async () => {
    const { cliente } = clienteFalso({
      'brands.insert': { error: { code: '23505', message: 'duplicate key value violates "brands_slug_key" slug' } },
    });
    const r = await guardarTaxonomiaBd({ cliente, def: TAXONOMIAS.marcas, datos, ...comun });
    expect(r).toMatchObject({ ok: false, errores: { slug: expect.any(String) } });
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('al actualizar audita solo el diff', async () => {
    const { cliente } = clienteFalso({ 'genders.select': { data: { id: 'g1', name: 'Viejo', slug: 'arabe', sort_order: 0 } } });
    const r = await guardarTaxonomiaBd({
      cliente,
      def: TAXONOMIAS.generos,
      datos: { ...datos, id: 'g1' },
      ...comun,
    });
    expect(r.ok).toBe(true);
    const llamada = auditar.mock.calls[0] as unknown as [{ diff: { antes: object; despues: object } }];
    expect(llamada[0].diff).toEqual({ antes: { name: 'Viejo' }, despues: { name: 'Árabe' } });
  });

  it('un registro que ya no existe no se actualiza', async () => {
    const { cliente } = clienteFalso({});
    const r = await guardarTaxonomiaBd({ cliente, def: TAXONOMIAS.generos, datos: { ...datos, id: 'x' }, ...comun });
    expect(r.ok).toBe(false);
  });
});

describe('eliminarTaxonomiaBd', () => {
  it('no elimina si hay productos que la usan', async () => {
    const { cliente, llamadas } = clienteFalso({ 'products.select': { count: 3 } });
    const r = await eliminarTaxonomiaBd({ cliente, def: TAXONOMIAS.marcas, id: 'b1', ...comun });
    expect(r).toMatchObject({ ok: false });
    expect(llamadas.some((l) => l.clave === 'brands.delete')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('elimina, audita el antes e invalida cuando nadie la usa', async () => {
    const { cliente, llamadas } = clienteFalso({
      'products.select': { count: 0 },
      'brands.select': { data: { id: 'b1', name: 'X' } },
    });
    const r = await eliminarTaxonomiaBd({ cliente, def: TAXONOMIAS.marcas, id: 'b1', ...comun });
    expect(r.ok).toBe(true);
    expect(llamadas.some((l) => l.clave === 'brands.delete')).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'brands.eliminado' }));
    expect(revalidar).toHaveBeenCalled();
  });
});
