import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaCategoriaGasto, esquemaGasto, leerFiltrosGasto, type DatosGasto } from './gastos';
import {
  eliminarCategoriaGastoBd,
  eliminarGastoBd,
  guardarCategoriaGastoBd,
  guardarGastoBd,
  listarGastos,
  totalesPorCategoria,
} from './servidor';

const comun = { actor: 'u1', ip: null };
const CAT = '22222222-2222-4222-8222-222222222222';
const ID = '11111111-1111-4111-8111-111111111111';
const RANGO = { desde: '2026-11-01', hasta: '2026-11-30' };

const datos = (o: Record<string, string> = {}): DatosGasto =>
  esquemaGasto('CO', '2026-11-30').parse({ country_code: 'CO', category_id: CAT, date: '2026-11-05', amount: '150000', description: 'Cajas', ...o });

beforeEach(() => auditar.mockClear());

describe('guardarGastoBd', () => {
  it('crea un gasto manual con valor entero en la moneda del país y audita', async () => {
    const { cliente, llamadas } = clienteFalso({ 'expense_categories.select': { data: { id: CAT } }, 'expenses.insert': { data: { id: ID } } });
    expect(await guardarGastoBd({ cliente, datos: datos(), ...comun })).toEqual({ ok: true, id: ID });
    const fila = llamadas.find((l) => l.clave === 'expenses.insert')!.args[0] as Record<string, unknown>;
    expect(fila).toMatchObject({ amount: '150000', currency_code: 'COP', source: 'manual', created_by: 'u1', country_code: 'CO' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'gastos.creado', entidadId: ID }));
  });

  it('en Ecuador la moneda es USD y el valor va en centavos', async () => {
    const { cliente, llamadas } = clienteFalso({ 'expense_categories.select': { data: { id: CAT } }, 'expenses.insert': { data: { id: ID } } });
    await guardarGastoBd({ cliente, datos: esquemaGasto('EC', '2026-11-30').parse({ country_code: 'EC', category_id: CAT, date: '2026-11-05', amount: '12.50' }), ...comun });
    expect(llamadas.find((l) => l.clave === 'expenses.insert')!.args[0]).toMatchObject({ amount: '1250', currency_code: 'USD' });
  });

  it('categoría inexistente: error en el campo, sin escribir', async () => {
    const { cliente, llamadas } = clienteFalso({ 'expense_categories.select': { data: null } });
    expect(await guardarGastoBd({ cliente, datos: datos(), ...comun })).toMatchObject({ ok: false, errores: { category_id: expect.any(String) } });
    expect(llamadas.some((l) => l.clave === 'expenses.insert')).toBe(false);
  });

  it('edita un gasto manual con diff en la auditoría', async () => {
    const { cliente, filtros } = clienteFalso({
      'expense_categories.select': { data: { id: CAT } },
      'expenses.select': { data: { id: ID, source: 'manual', country_code: 'CO', category_id: CAT, date: '2026-11-05', amount: 100000, currency_code: 'COP', description: 'Cajas' } },
      'expenses.update': {},
    });
    expect(await guardarGastoBd({ cliente, datos: { ...datos(), id: ID }, ...comun })).toEqual({ ok: true, id: ID });
    expect(filtros.some((f) => f.tabla === 'expenses' && f.metodo === 'eq' && f.args[0] === 'source' && f.args[1] === 'manual')).toBe(true);
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'gastos.actualizado', diff: { antes: { amount: 100000 }, despues: { amount: '150000' } } }),
    );
  });

  it('no edita gastos de sincronizaciones automáticas', async () => {
    const { cliente, llamadas } = clienteFalso({
      'expense_categories.select': { data: { id: CAT } },
      'expenses.select': { data: { id: ID, source: 'meta_ads' } },
    });
    expect(await guardarGastoBd({ cliente, datos: { ...datos(), id: ID }, ...comun })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/sincronización/) });
    expect(llamadas.some((l) => l.clave === 'expenses.update')).toBe(false);
  });
});

describe('comprobante del gasto', () => {
  it('guarda el comprobante solo si es una imagen subida como «expense»', async () => {
    const ok = clienteFalso({
      'expense_categories.select': { data: { id: CAT } },
      'media.select': { data: { id: CAT } },
      'expenses.insert': { data: { id: ID } },
    });
    expect((await guardarGastoBd({ cliente: ok.cliente, datos: datos({ attachment_media_id: CAT }), ...comun })).ok).toBe(true);
    expect(ok.llamadas.find((l) => l.clave === 'expenses.insert')!.args[0]).toMatchObject({ attachment_media_id: CAT });
    expect(ok.filtros.some((f) => f.tabla === 'media' && f.metodo === 'eq' && f.args[0] === 'kind' && f.args[1] === 'expense')).toBe(true);

    const no = clienteFalso({ 'expense_categories.select': { data: { id: CAT } }, 'media.select': { data: null } });
    expect(await guardarGastoBd({ cliente: no.cliente, datos: datos({ attachment_media_id: CAT }), ...comun })).toMatchObject({
      ok: false,
      errores: { attachment_media_id: expect.any(String) },
    });
    expect(no.llamadas.some((l) => l.clave === 'expenses.insert')).toBe(false);
  });
});

describe('eliminarGastoBd', () => {
  it('borra un manual y guarda el registro completo en la auditoría', async () => {
    const antes = { id: ID, source: 'manual', amount: 5000 };
    const { cliente } = clienteFalso({ 'expenses.select': { data: antes }, 'expenses.delete': {} });
    expect(await eliminarGastoBd({ cliente, id: ID, ...comun })).toEqual({ ok: true });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'gastos.eliminado', diff: { antes } }));
  });

  it('no borra los automáticos', async () => {
    const { cliente, llamadas } = clienteFalso({ 'expenses.select': { data: { id: ID, source: 'mastershop_wallet' } } });
    expect(await eliminarGastoBd({ cliente, id: ID, ...comun })).toMatchObject({ ok: false });
    expect(llamadas.some((l) => l.clave === 'expenses.delete')).toBe(false);
  });
});

describe('categorías', () => {
  it('crea con slug derivado y prefijo pauta_', async () => {
    const { cliente, llamadas } = clienteFalso({ 'expense_categories.insert': { data: { id: 'c1' } } });
    const d = esquemaCategoriaGasto.parse({ name: 'Pauta TikTok Ads', es_pauta: 'on' });
    expect(await guardarCategoriaGastoBd({ cliente, datos: d, ...comun })).toEqual({ ok: true, id: 'c1' });
    expect(llamadas.find((l) => l.clave === 'expense_categories.insert')!.args[0]).toEqual({ slug: 'pauta_tiktok_ads', name: 'Pauta TikTok Ads', is_system: false });
  });

  it('nombre repetido: error claro', async () => {
    const { cliente } = clienteFalso({ 'expense_categories.insert': { error: { code: '23505', message: 'duplicate key', details: 'Key (slug)=(nomina)' } } });
    const r = await guardarCategoriaGastoBd({ cliente, datos: esquemaCategoriaGasto.parse({ name: 'Nómina' }), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { slug: expect.stringMatching(/Ya existe/) } });
  });

  it('no elimina las del sistema ni las que tienen gastos', async () => {
    const sistema = clienteFalso({ 'expense_categories.select': { data: { id: 'c', is_system: true } } });
    expect(await eliminarCategoriaGastoBd({ cliente: sistema.cliente, id: 'c', ...comun })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/sistema/) });
    const conGastos = clienteFalso({ 'expense_categories.select': { data: { id: 'c', is_system: false } }, 'expenses.select': { count: 3 } });
    expect(await eliminarCategoriaGastoBd({ cliente: conGastos.cliente, id: 'c', ...comun })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/tiene gastos/) });
    const libre = clienteFalso({ 'expense_categories.select': { data: { id: 'c', is_system: false } }, 'expenses.select': { count: 0 }, 'expense_categories.delete': {} });
    expect(await eliminarCategoriaGastoBd({ cliente: libre.cliente, id: 'c', ...comun })).toEqual({ ok: true });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'gastos.categoria_eliminada' }));
  });
});

describe('lecturas', () => {
  it('lista con los filtros de país, rango, categoría y origen', async () => {
    const { cliente, filtros } = clienteFalso({ 'expenses.select': { data: [{ id: ID, expense_categories: [{ name: 'Cajas', slug: 'cajas' }] }], count: 1 } });
    const r = await listarGastos(cliente, 'CO', RANGO, leerFiltrosGasto({ categoria: CAT, origen: 'manual' }));
    expect(r.total).toBe(1);
    expect(r.filas[0]!.expense_categories).toEqual({ name: 'Cajas', slug: 'cajas' });
    expect(filtros.map((f) => [f.metodo, ...f.args])).toEqual(
      expect.arrayContaining([
        ['eq', 'country_code', 'CO'],
        ['gte', 'date', '2026-11-01'],
        ['lte', 'date', '2026-11-30'],
        ['eq', 'category_id', CAT],
        ['eq', 'source', 'manual'],
      ]),
    );
  });

  it('suma por categoría con enteros exactos, de mayor a menor', async () => {
    const { cliente } = clienteFalso({
      'expenses.select': {
        data: [
          { category_id: 'a', amount: 1000, expense_categories: { name: 'A', slug: 'a' } },
          { category_id: 'b', amount: 5000, expense_categories: { name: 'B', slug: 'b' } },
          { category_id: 'a', amount: '2500', expense_categories: { name: 'A', slug: 'a' } },
        ],
      },
    });
    const t = await totalesPorCategoria(cliente, 'CO', RANGO, { categoria: '', origen: '' });
    expect(t.total).toBe(8500n);
    expect(t.filas.map((f) => [f.nombre, f.total])).toEqual([['B', 5000n], ['A', 3500n]]);
    expect(t.truncado).toBe(false);
  });
});
