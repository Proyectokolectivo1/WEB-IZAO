import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaPagina } from './paginas';
import { eliminarPaginaBd, guardarPaginaBd } from './paginas-servidor';

const comun = { actor: 'u1', ip: null };
const datos = (extra: Record<string, unknown> = {}) =>
  esquemaPagina.parse({
    country_code: 'CO',
    kind: 'tratamiento_datos',
    slug: 'tratamiento-de-datos',
    title: 'Política de datos',
    content_html: '<p>Texto</p>',
    status: 'published',
    ...extra,
  });
const ID = '11111111-1111-4111-8111-111111111111';
const ID_VIEJA = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('guardarPaginaBd · publicación única por país y tipo', () => {
  it('al publicar despublica la anterior del mismo país y tipo, antes de escribir la nueva', async () => {
    const { cliente, llamadas } = clienteFalso({
      'pages.select': { data: { id: ID_VIEJA, title: 'Vieja', country_code: 'CO', kind: 'tratamiento_datos' } },
      'pages.insert': { data: { id: ID } },
    });
    const r = await guardarPaginaBd({ cliente, datos: datos(), ...comun });
    expect(r).toEqual({ ok: true, id: ID, despublicada: 'Vieja' });
    const orden = llamadas.map((l) => l.clave).filter((c) => c === 'pages.update' || c === 'pages.insert');
    expect(orden).toEqual(['pages.update', 'pages.insert']);
    expect((llamadas.find((l) => l.clave === 'pages.update')?.args[0] as { status: string }).status).toBe('draft');
    expect(auditar.mock.calls.map((c) => (c[0] as { accion: string }).accion)).toEqual(['pages.despublicada', 'pages.creada']);
  });

  it('si la escritura de la nueva falla, vuelve a publicar la anterior', async () => {
    const { cliente, llamadas } = clienteFalso({
      'pages.select': { data: { id: ID_VIEJA, title: 'Vieja', country_code: 'CO', kind: 'tratamiento_datos' } },
      'pages.insert': { error: { code: '23505', message: 'duplicate key', details: 'Key (country_code, slug)=(CO, x) already exists.' } },
    });
    const r = await guardarPaginaBd({ cliente, datos: datos(), ...comun });
    expect(r.ok).toBe(false);
    const estados = llamadas.filter((l) => l.clave === 'pages.update').map((l) => (l.args[0] as { status: string }).status);
    expect(estados).toEqual(['draft', 'published']);
    expect(revalidar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('no despublica nada si el tipo es general', async () => {
    const { cliente, llamadas } = clienteFalso({ 'pages.insert': { data: { id: ID } } });
    const r = await guardarPaginaBd({ cliente, datos: datos({ kind: 'general', slug: 'promo' }), ...comun });
    expect(r).toEqual({ ok: true, id: ID });
    expect(llamadas.some((l) => l.clave === 'pages.update')).toBe(false);
  });

  it('un borrador no toca a la publicada', async () => {
    const { cliente, llamadas } = clienteFalso({ 'pages.insert': { data: { id: ID } } });
    await guardarPaginaBd({ cliente, datos: datos({ status: 'draft' }), ...comun });
    expect(llamadas.some((l) => l.clave === 'pages.update')).toBe(false);
  });

  it('no publica con marcadores sin resolver y no escribe nada', async () => {
    const { cliente, llamadas } = clienteFalso({});
    const r = await guardarPaginaBd({ cliente, datos: datos({ content_html: '<p>NIT [NIT]</p>' }), ...comun });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores?.content_html).toContain('[NIT]');
    expect(llamadas).toEqual([]);
  });
});

describe('guardarPaginaBd · versión e invalidación', () => {
  const previa = { id: ID, country_code: 'CO', kind: 'tratamiento_datos', slug: 'tratamiento-de-datos', title: 'Política de datos', content_html: '<p>Viejo</p>', seo_title: null, seo_description: null, status: 'published', version: 4, updated_by: null, updated_at: '2026-01-01T00:00:00Z' };

  it('sube la versión al cambiar el texto de una publicada e invalida content:CO', async () => {
    const { cliente, llamadas } = clienteFalso({
      // 1.ª lectura: la página; 2.ª: no hay otra publicada del tipo.
      'pages.select': [{ data: previa }, { data: null }],
      'pages.update': { data: null },
    });
    const r = await guardarPaginaBd({ cliente, datos: datos({ id: ID }), ...comun });
    expect(r.ok).toBe(true);
    const fila = llamadas.find((l) => l.clave === 'pages.update')?.args[0] as { version: number; updated_by: string };
    expect(fila.version).toBe(5);
    expect(fila.updated_by).toBe('u1');
    expect(revalidar).toHaveBeenCalledWith('content:CO');
    expect(revalidar).not.toHaveBeenCalledWith('content:EC');
  });

  it('conserva la versión si solo cambia el SEO', async () => {
    const { cliente, llamadas } = clienteFalso({
      'pages.select': [{ data: { ...previa, content_html: '<p>Texto</p>' } }, { data: null }],
    });
    await guardarPaginaBd({ cliente, datos: datos({ id: ID, seo_title: 'Nuevo' }), ...comun });
    expect((llamadas.find((l) => l.clave === 'pages.update')?.args[0] as { version: number }).version).toBe(4);
  });

  it('invalida el país anterior y el nuevo si cambia de país', async () => {
    const { cliente } = clienteFalso({ 'pages.select': [{ data: previa }, { data: null }] });
    await guardarPaginaBd({ cliente, datos: datos({ id: ID, country_code: 'EC' }), ...comun });
    expect(revalidar).toHaveBeenCalledWith('content:CO');
    expect(revalidar).toHaveBeenCalledWith('content:EC');
  });

  it('el diff de auditoría no lleva el HTML completo', async () => {
    const { cliente } = clienteFalso({ 'pages.select': [{ data: previa }, { data: null }] });
    await guardarPaginaBd({ cliente, datos: datos({ id: ID }), ...comun });
    const diff = JSON.stringify((auditar.mock.calls.at(-1)?.[0] as { diff: unknown }).diff);
    expect(diff).not.toContain('<p>');
  });

  it('una página que ya no existe devuelve error', async () => {
    const { cliente } = clienteFalso({ 'pages.select': { data: null } });
    const r = await guardarPaginaBd({ cliente, datos: datos({ id: ID }), ...comun });
    expect(r.ok).toBe(false);
  });
});

describe('eliminarPaginaBd', () => {
  it('no elimina una publicada', async () => {
    const { cliente, llamadas } = clienteFalso({ 'pages.select': { data: { id: ID, country_code: 'CO', status: 'published', slug: 's', title: 't', kind: 'general', version: 1 } } });
    const r = await eliminarPaginaBd({ cliente, id: ID, ...comun });
    expect(r.ok).toBe(false);
    expect(llamadas.some((l) => l.clave === 'pages.delete')).toBe(false);
  });

  it('elimina un borrador, audita e invalida', async () => {
    const { cliente, llamadas } = clienteFalso({ 'pages.select': { data: { id: ID, country_code: 'EC', status: 'draft', slug: 's', title: 't', kind: 'general', version: 1 } } });
    const r = await eliminarPaginaBd({ cliente, id: ID, ...comun });
    expect(r.ok).toBe(true);
    expect(llamadas.some((l) => l.clave === 'pages.delete')).toBe(true);
    expect(revalidar).toHaveBeenCalledWith('content:EC');
    expect(auditar).toHaveBeenCalled();
  });
});
