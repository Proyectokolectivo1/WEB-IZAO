import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, invalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), invalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: invalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaResenaAdmin, leerFiltrosResena } from './resenas';
import { contarResenas, destacarResenaBd, eliminarResenaBd, guardarResenaAdminBd, listarResenas, moderarResenaBd } from './servidor';

const comun = { actor: 'u1', ip: null };
const P = '55555555-5555-4555-8555-555555555555';
const resena = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  country_code: 'CO',
  product_id: P,
  author_name: 'Ana',
  city: null,
  rating: 5,
  body: 'Huele muy rico',
  source: 'customer',
  is_verified_purchase: true,
  status: 'pending',
  featured_home: false,
  created_at: '2026-10-20T10:00:00Z',
  products: [{ name: 'Sauvage', slug: 'sauvage' }],
  ...o,
});

beforeEach(() => {
  auditar.mockClear();
  invalidar.mockClear();
});

describe('listar y contar', () => {
  it('filtra por estado, país, origen y destacadas, y normaliza el producto embebido', async () => {
    const { cliente, filtros } = clienteFalso({ 'reviews.select': { data: [resena()], count: 1 } });
    const r = await listarResenas(cliente, leerFiltrosResena({ estado: 'approved', pais: 'CO', fuente: 'customer', destacadas: '1' }));
    expect(r.filas[0]!.products).toEqual({ name: 'Sauvage', slug: 'sauvage' });
    expect(filtros.map((f) => [f.metodo, ...f.args])).toEqual(
      expect.arrayContaining([['eq', 'status', 'approved'], ['eq', 'country_code', 'CO'], ['eq', 'source', 'customer'], ['eq', 'featured_home', true]]),
    );
  });

  it('"todas" no filtra por estado', async () => {
    const { cliente, filtros } = clienteFalso({ 'reviews.select': { data: [], count: 0 } });
    await listarResenas(cliente, leerFiltrosResena({ estado: 'todas' }));
    expect(filtros.some((f) => f.args[0] === 'status')).toBe(false);
  });

  it('cuenta por estado', async () => {
    const { cliente } = clienteFalso({ 'reviews.select': { count: 3 } });
    expect(await contarResenas(cliente, 'EC')).toEqual({ pending: 3, approved: 3, rejected: 3 });
  });
});

describe('moderarResenaBd', () => {
  it('aprobar invalida la ficha del producto y el contenido del país', async () => {
    const { cliente, llamadas } = clienteFalso({ 'reviews.select': { data: resena() }, 'reviews.update': {} });
    expect(await moderarResenaBd({ cliente, id: 'r1', estado: 'approved', ...comun })).toEqual({ ok: true, id: 'r1' });
    expect(llamadas.find((l) => l.clave === 'reviews.update')!.args[0]).toEqual({ status: 'approved', featured_home: false });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'resenas.aprobada', entidadId: 'r1' }));
    expect(invalidar).toHaveBeenCalledWith(`product:${P}`);
    expect(invalidar).toHaveBeenCalledWith('content:CO');
    expect(invalidar).not.toHaveBeenCalledWith('content:EC');
  });

  it('rechazar una destacada la saca del home', async () => {
    const { cliente, llamadas } = clienteFalso({ 'reviews.select': { data: resena({ status: 'approved', featured_home: true }) }, 'reviews.update': {} });
    await moderarResenaBd({ cliente, id: 'r1', estado: 'rejected', ...comun });
    expect(llamadas.find((l) => l.clave === 'reviews.update')!.args[0]).toEqual({ status: 'rejected', featured_home: false });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'resenas.rechazada' }));
  });

  it('una reseña inexistente o un estado inventado no tocan nada', async () => {
    const a = clienteFalso({ 'reviews.select': { data: null } });
    expect(await moderarResenaBd({ cliente: a.cliente, id: 'x', estado: 'approved', ...comun })).toMatchObject({ ok: false });
    expect(await moderarResenaBd({ cliente: a.cliente, id: 'x', estado: 'spam' as never, ...comun })).toMatchObject({ ok: false });
    expect(a.llamadas.some((l) => l.clave === 'reviews.update')).toBe(false);
  });
});

describe('destacarResenaBd', () => {
  it('destaca una aprobada, rechaza destacar una no aprobada', async () => {
    const ok = clienteFalso({ 'reviews.select': { data: resena({ status: 'approved' }) }, 'reviews.update': {} });
    expect((await destacarResenaBd({ cliente: ok.cliente, id: 'r1', destacada: true, ...comun })).ok).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'resenas.destacada' }));
    const no = clienteFalso({ 'reviews.select': { data: resena({ status: 'pending' }) } });
    expect(await destacarResenaBd({ cliente: no.cliente, id: 'r1', destacada: true, ...comun })).toMatchObject({ ok: false, mensaje: expect.stringMatching(/aprobada/) });
    expect(no.llamadas.some((l) => l.clave === 'reviews.update')).toBe(false);
  });
});

describe('guardarResenaAdminBd', () => {
  const datos = (o: Record<string, string> = {}) =>
    esquemaResenaAdmin.parse({ country_code: 'CO', product_slug: 'sauvage', author_name: 'Laura', rating: '5', body: 'Me llegó muy bien empacado.', status: 'approved', ...o });

  it('crea una reseña de Izao ligada al producto por su URL', async () => {
    const { cliente, llamadas } = clienteFalso({ 'products.select': { data: { id: P } }, 'reviews.insert': { data: { id: 'n' } } });
    expect(await guardarResenaAdminBd({ cliente, datos: datos(), ...comun })).toEqual({ ok: true, id: 'n' });
    expect(llamadas.find((l) => l.clave === 'reviews.insert')!.args[0]).toMatchObject({ product_id: P, source: 'admin', is_verified_purchase: false, rating: 5, status: 'approved' });
    expect(invalidar).toHaveBeenCalledWith(`product:${P}`);
  });

  it('un producto que no existe da error en el campo', async () => {
    const { cliente, llamadas } = clienteFalso({ 'products.select': { data: null } });
    expect(await guardarResenaAdminBd({ cliente, datos: datos(), ...comun })).toMatchObject({ ok: false, errores: { product_slug: expect.any(String) } });
    expect(llamadas.some((l) => l.clave === 'reviews.insert')).toBe(false);
  });

  it('una reseña de tienda no tiene producto; la de un cliente no se edita', async () => {
    const tienda = clienteFalso({ 'reviews.insert': { data: { id: 'n' } } });
    await guardarResenaAdminBd({ cliente: tienda.cliente, datos: datos({ product_slug: '' }), ...comun });
    expect(tienda.llamadas.find((l) => l.clave === 'reviews.insert')!.args[0]).toMatchObject({ product_id: null });
    const cli = clienteFalso({ 'products.select': { data: { id: P } }, 'reviews.select': { data: resena() } });
    const r = await guardarResenaAdminBd({ cliente: cli.cliente, datos: { ...datos(), id: 'r1' }, ...comun });
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/clientes no se editan/) });
    expect(cli.llamadas.some((l) => l.clave === 'reviews.update')).toBe(false);
  });
});

describe('eliminarResenaBd', () => {
  it('borra y guarda el registro en la auditoría', async () => {
    const { cliente } = clienteFalso({ 'reviews.select': { data: resena() }, 'reviews.delete': {} });
    expect(await eliminarResenaBd({ cliente, id: 'r1', ...comun })).toEqual({ ok: true });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'resenas.eliminada', diff: { antes: expect.objectContaining({ id: 'r1' }) } }));
  });
});
