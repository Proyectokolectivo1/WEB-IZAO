import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { TAXONOMIAS, esquemaTaxonomia } from './taxonomias';
import { eliminarTaxonomiaBd, guardarTaxonomiaBd, type Cliente } from './taxonomias-servidor';

type Respuesta = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };

/** Cliente falso: cada `tabla.operación` devuelve la respuesta preparada y registra la llamada. */
function clienteFalso(respuestas: Record<string, Respuesta>) {
  const llamadas: { clave: string; args: unknown[] }[] = [];
  const cliente = {
    from(tabla: string) {
      let op = 'select';
      const b: Record<string, unknown> = {};
      const resolver = () => ({ data: null, error: null, count: null, ...(respuestas[`${tabla}.${op}`] ?? {}) });
      for (const m of ['select', 'insert', 'update', 'delete']) {
        b[m] = (...args: unknown[]) => {
          if (m !== 'select' || op === 'select') op = m;
          llamadas.push({ clave: `${tabla}.${m}`, args });
          return b;
        };
      }
      for (const m of ['eq', 'order', 'range', 'ilike']) b[m] = () => b;
      b.maybeSingle = async () => resolver();
      b.single = async () => resolver();
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
      return b;
    },
  };
  return { cliente: cliente as unknown as Cliente, llamadas };
}

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
