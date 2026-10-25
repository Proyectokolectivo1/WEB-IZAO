import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaCodigo, esquemaLote, type DatosCodigo } from './codigos';
import {
  alternarCodigoBd,
  crearLoteBd,
  eliminarCodigoBd,
  guardarCodigoBd,
  listarCodigos,
  reporteUsoCodigo,
} from './codigos-servidor';

const comun = { actor: 'u1', ip: null };
const CAT = '33333333-3333-4333-8333-333333333333';
const INF = '44444444-4444-4444-8444-444444444444';

const datos = (extra: Record<string, unknown> = {}): DatosCodigo =>
  esquemaCodigo.parse({ code: 'VERANO10', country_code: 'CO', type: 'percent', value: '10', applies_to: 'all', ...extra });

beforeEach(() => auditar.mockClear());

describe('guardarCodigoBd', () => {
  it('crea el código con montos como texto de entero, origen manual y auditoría', async () => {
    const { cliente, llamadas } = clienteFalso({ 'discount_codes.insert': { data: { id: 'c1' } } });
    const r = await guardarCodigoBd({ cliente, datos: datos({ min_subtotal: '80000' }), ...comun });
    expect(r).toEqual({ ok: true, id: 'c1' });
    const fila = llamadas.find((l) => l.clave === 'discount_codes.insert')?.args[0] as Record<string, unknown>;
    expect(fila).toMatchObject({ code: 'VERANO10', value: '10', min_subtotal: '80000', origin: 'manual', target_ids: [] });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'discount_codes.creado', entidadId: 'c1' }));
  });

  it('código repetido: error en el campo code, sin auditar', async () => {
    const { cliente } = clienteFalso({ 'discount_codes.insert': { error: { code: '23505', message: 'duplicate key' } } });
    const r = await guardarCodigoBd({ cliente, datos: datos(), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { code: expect.stringMatching(/Ya existe/) } });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('productos que no existen vuelven como error del campo y no se escribe nada', async () => {
    const { cliente, llamadas } = clienteFalso({ 'products.select': { data: [{ id: 'p1', slug: 'uno' }] } });
    const d = datos({ applies_to: 'products', target_products: 'uno dos' });
    const r = await guardarCodigoBd({ cliente, datos: d, ...comun });
    expect(r).toMatchObject({ ok: false, errores: { target_products: expect.stringContaining('dos') } });
    expect(llamadas.some((l) => l.clave === 'discount_codes.insert')).toBe(false);
  });

  it('resuelve las URL de producto a ids y junta exclusiones de categoría y producto', async () => {
    const { cliente, llamadas } = clienteFalso({
      'products.select': { data: [{ id: 'p1', slug: 'uno' }, { id: 'p2', slug: 'dos' }] },
      'categories.select': { data: [{ id: CAT }] },
      'discount_codes.insert': { data: { id: 'c2' } },
    });
    const d = datos({ applies_to: 'products', target_products: 'uno', exclude_products: 'dos', exclude_categories: CAT });
    const r = await guardarCodigoBd({ cliente, datos: d, ...comun });
    expect(r.ok).toBe(true);
    const fila = llamadas.find((l) => l.clave === 'discount_codes.insert')?.args[0] as Record<string, unknown>;
    expect(fila.target_ids).toEqual(['p1']);
    expect(fila.exclude_ids).toEqual([CAT, 'p2']);
  });

  it('el influencer debe existir y ser del mismo país', async () => {
    const { cliente } = clienteFalso({ 'influencers.select': { data: { id: INF, country_code: 'EC' } } });
    const r = await guardarCodigoBd({ cliente, datos: datos({ influencer_id: INF }), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { influencer_id: expect.stringMatching(/mismo país/) } });
    const sin = clienteFalso({ 'influencers.select': { data: null } });
    const r2 = await guardarCodigoBd({ cliente: sin.cliente, datos: datos({ influencer_id: INF }), ...comun });
    expect(r2).toMatchObject({ ok: false, errores: { influencer_id: expect.stringMatching(/ya no existe/) } });
  });

  it('al editar guarda solo el diff y no deja cambiar el país de un código ya usado', async () => {
    const antes = { id: 'c1', code: 'VERANO10', country_code: 'CO', value: 10, usage_count: 0 };
    const ok = clienteFalso({ 'discount_codes.select': { data: antes }, 'discount_codes.update': {} });
    const r = await guardarCodigoBd({ cliente: ok.cliente, datos: { ...datos({ value: '15' }), id: 'c1' }, ...comun });
    expect(r).toEqual({ ok: true, id: 'c1' });
    const evento = auditar.mock.calls[0]?.[0] as { diff: { antes: Record<string, unknown>; despues: Record<string, unknown> } };
    expect(evento.diff.despues.value).toBe('15');

    const usado = clienteFalso({ 'discount_codes.select': { data: { ...antes, usage_count: 3 } } });
    const r2 = await guardarCodigoBd({ cliente: usado.cliente, datos: { ...datos({ country_code: 'EC' }), id: 'c1' }, ...comun });
    expect(r2).toMatchObject({ ok: false, errores: { country_code: expect.any(String) } });
    expect(usado.llamadas.some((l) => l.clave === 'discount_codes.update')).toBe(false);
  });
});

describe('alternar y eliminar', () => {
  it('alternar audita el antes y el después', async () => {
    const { cliente } = clienteFalso({ 'discount_codes.select': { data: { id: 'c1', is_active: true } } });
    expect(await alternarCodigoBd({ cliente, id: 'c1', activo: false, ...comun })).toEqual({ ok: true });
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'discount_codes.desactivado', diff: { antes: { is_active: true }, despues: { is_active: false } } }),
    );
  });

  it('no elimina un código con canjes aunque estén liberados', async () => {
    const { cliente, llamadas } = clienteFalso({
      'discount_codes.select': { data: { id: 'c1', usage_count: 0 } },
      'discount_redemptions.select': { count: 2 },
    });
    const r = await eliminarCodigoBd({ cliente, id: 'c1', ...comun });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/Desactívalo/) });
    expect(llamadas.some((l) => l.clave === 'discount_codes.delete')).toBe(false);
  });

  it('elimina un código sin usos y lo audita', async () => {
    const { cliente } = clienteFalso({
      'discount_codes.select': { data: { id: 'c1', usage_count: 0 } },
      'discount_redemptions.select': { count: 0 },
    });
    expect(await eliminarCodigoBd({ cliente, id: 'c1', ...comun })).toEqual({ ok: true });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'discount_codes.eliminado' }));
  });
});

describe('crearLoteBd', () => {
  const lote = (cantidad: string) => esquemaLote.parse({ prefix: 'verano', quantity: cantidad, country_code: 'CO', type: 'percent', value: '10', applies_to: 'all' });
  let n = 0;
  const azar = (max: number) => n++ % max;

  it('inserta todos los códigos en una sola sentencia con origen batch', async () => {
    n = 0;
    const { cliente, llamadas } = clienteFalso({ 'discount_codes.select': { data: [] }, 'discount_codes.insert': {} });
    const r = await crearLoteBd({ cliente, datos: lote('5'), azar, ...comun });
    expect(r.ok).toBe(true);
    expect(r.codigos).toHaveLength(5);
    const filas = llamadas.find((l) => l.clave === 'discount_codes.insert')?.args[0] as { code: string; origin: string }[];
    expect(filas).toHaveLength(5);
    expect(filas.every((f) => f.origin === 'batch' && f.code.startsWith('VERANO-'))).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'discount_codes.lote' }));
  });

  it('si choca con códigos existentes regenera y reintenta; al tercer choque falla', async () => {
    n = 0;
    const choque = { error: { code: '23505', message: 'duplicate key' } };
    const una = clienteFalso({ 'discount_codes.select': { data: [] }, 'discount_codes.insert': [choque, {}] });
    const r = await crearLoteBd({ cliente: una.cliente, datos: lote('3'), azar, ...comun });
    expect(r.ok).toBe(true);
    expect(una.llamadas.filter((l) => l.clave === 'discount_codes.insert')).toHaveLength(2);

    auditar.mockClear();
    const tres = clienteFalso({ 'discount_codes.select': { data: [] }, 'discount_codes.insert': choque });
    const f = await crearLoteBd({ cliente: tres.cliente, datos: lote('3'), azar, ...comun });
    expect(f.ok).toBe(false);
    expect(tres.llamadas.filter((l) => l.clave === 'discount_codes.insert')).toHaveLength(3);
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe('lecturas', () => {
  it('listarCodigos filtra por país, origen y estado vencido en SQL', async () => {
    const { cliente, filtros } = clienteFalso({ 'discount_codes.select': { data: [], count: 0 } });
    await listarCodigos(cliente, { pais: 'EC', estado: 'vencido', origen: 'batch', q: 'VER', pagina: 1 }, new Date('2026-11-15T12:00:00Z'));
    const m = (metodo: string) => filtros.filter((f) => f.metodo === metodo).map((f) => f.args);
    expect(m('eq')).toEqual(expect.arrayContaining([['country_code', 'EC'], ['origin', 'batch'], ['is_active', true]]));
    expect(m('lte')).toEqual([['ends_at', '2026-11-15T12:00:00.000Z']]);
    expect(m('ilike')).toEqual([['code', '%VER%']]);
  });

  it('reporteUsoCodigo suma por estado en bigint', async () => {
    const { cliente } = clienteFalso({
      'discount_redemptions.select': {
        data: [
          { status: 'confirmed', amount: 10000, created_at: '2026-11-02T00:00:00Z', orders: { number: 'IZ-CO-000001', status: 'entregado' } },
          { status: 'confirmed', amount: 5000, created_at: '2026-11-01T00:00:00Z', orders: { number: 'IZ-CO-000002', status: 'pagado' } },
          { status: 'released', amount: 7000, created_at: '2026-10-30T00:00:00Z', orders: null },
        ],
      },
    });
    const r = await reporteUsoCodigo(cliente, 'c1');
    expect(r.canjes.confirmed).toEqual({ cantidad: 2, monto: 15000n });
    expect(r.canjes.released).toEqual({ cantidad: 1, monto: 7000n });
    expect(r.canjes.reserved).toEqual({ cantidad: 0, monto: 0n });
    expect(r.recientes[2]?.numero).toBeNull();
  });
});
