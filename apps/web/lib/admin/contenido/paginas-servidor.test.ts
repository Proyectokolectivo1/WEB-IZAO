import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaPagina } from './paginas';
import type { EntradaPagina } from '@/lib/db/panel-atomicas';
import { eliminarPaginaBd, guardarPaginaBd, type PublicarDb } from './paginas-servidor';

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

const exito = (extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  estado: 'creada' as 'creada' | 'actualizada',
  id: ID,
  version: 1,
  status: 'published' as 'draft' | 'published',
  publicada_ahora: true,
  despublicada: null as { id: string; title: string; country_code: string } | null,
  antes: null as null | {
    country_code: string;
    kind: string;
    slug: string;
    title: string;
    status: string;
    version: number;
    seo_title: string | null;
    seo_description: string | null;
    content_length: number;
  },
  ...extra,
});
const publicarCon = (r: Awaited<ReturnType<PublicarDb>>) => vi.fn(async (_e: EntradaPagina) => r);
const antes = (extra: Record<string, unknown> = {}) => ({
  country_code: 'CO',
  kind: 'tratamiento_datos',
  slug: 'tratamiento-de-datos',
  title: 'Política de datos',
  status: 'published',
  version: 4,
  seo_title: null,
  seo_description: null,
  content_length: 14,
  ...extra,
});
const { cliente: sinCliente } = clienteFalso({});

describe('guardarPaginaBd (RPC atómica admin_publicar_pagina)', () => {
  it('manda la página completa y el actor, y avisa de la que quedó en borrador', async () => {
    const publicar = publicarCon(exito({ despublicada: { id: ID_VIEJA, title: 'Vieja', country_code: 'CO' } }));
    const r = await guardarPaginaBd({ cliente: sinCliente, datos: datos(), publicar, ...comun });
    expect(r).toEqual({ ok: true, id: ID, despublicada: 'Vieja' });
    expect(publicar).toHaveBeenCalledWith({
      country_code: 'CO',
      kind: 'tratamiento_datos',
      slug: 'tratamiento-de-datos',
      title: 'Política de datos',
      content_html: '<p>Texto</p>',
      seo_title: null,
      seo_description: null,
      status: 'published',
      updated_by: 'u1',
    });
    expect(auditar.mock.calls.map((c) => (c[0] as { accion: string }).accion)).toEqual(['pages.despublicada', 'pages.creada']);
    expect(auditar.mock.calls[0]![0]).toMatchObject({ entidadId: ID_VIEJA, diff: { motivo: `reemplazada por ${ID}` } });
  });

  it('al editar manda el id; el resultado de la RPC define la acción auditada', async () => {
    const borrador = publicarCon(exito({ estado: 'actualizada', antes: antes({ status: 'draft' }) }));
    await guardarPaginaBd({ cliente: sinCliente, datos: datos({ id: ID }), publicar: borrador, ...comun });
    expect(borrador.mock.calls[0]![0]).toMatchObject({ id: ID });
    expect(auditar.mock.calls.at(-1)![0]).toMatchObject({ accion: 'pages.publicada' });

    const editada = publicarCon(exito({ estado: 'actualizada', antes: antes() }));
    await guardarPaginaBd({ cliente: sinCliente, datos: datos({ id: ID }), publicar: editada, ...comun });
    expect(auditar.mock.calls.at(-1)![0]).toMatchObject({ accion: 'pages.actualizada' });
  });

  it('no publica con marcadores sin resolver y ni siquiera llama a la RPC', async () => {
    const publicar = publicarCon(exito());
    const r = await guardarPaginaBd({ cliente: sinCliente, datos: datos({ content_html: '<p>NIT [NIT]</p>' }), publicar, ...comun });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores?.content_html).toContain('[NIT]');
    expect(publicar).not.toHaveBeenCalled();
  });

  it('traduce cada rechazo de la RPC sin auditar ni invalidar', async () => {
    const prueba = async (motivo: 'no_existe' | 'marcadores_pendientes' | 'slug_duplicado' | 'publicada_duplicada' | 'datos_invalidos') =>
      guardarPaginaBd({ cliente: sinCliente, datos: datos(), publicar: publicarCon({ ok: false, motivo }), ...comun });
    expect(await prueba('no_existe')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/ya no existe/) });
    expect(await prueba('slug_duplicado')).toMatchObject({ ok: false, errores: { slug: expect.any(String) } });
    expect(await prueba('publicada_duplicada')).toMatchObject({ ok: false, errores: { kind: expect.any(String) } });
    expect(await prueba('marcadores_pendientes')).toMatchObject({ ok: false, errores: { content_html: expect.any(String) } });
    expect(await prueba('datos_invalidos')).toMatchObject({ ok: false });
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });
});

describe('guardarPaginaBd · invalidación y auditoría', () => {
  it('invalida content:CO al guardar una página de Colombia y no toca Ecuador', async () => {
    await guardarPaginaBd({ cliente: sinCliente, datos: datos(), publicar: publicarCon(exito()), ...comun });
    expect(revalidar).toHaveBeenCalledWith('content:CO');
    expect(revalidar).not.toHaveBeenCalledWith('content:EC');
  });

  it('si cambia de país invalida el anterior y el nuevo; si reemplaza una de otro país, también ese', async () => {
    await guardarPaginaBd({ cliente: sinCliente, datos: datos({ id: ID, country_code: 'EC' }), publicar: publicarCon(exito({ estado: 'actualizada', antes: antes() })), ...comun });
    expect(revalidar).toHaveBeenCalledWith('content:CO');
    expect(revalidar).toHaveBeenCalledWith('content:EC');
  });

  it('el diff de auditoría no lleva el HTML completo y muestra qué cambió', async () => {
    await guardarPaginaBd({
      cliente: sinCliente,
      datos: datos({ id: ID, title: 'Nuevo título' }),
      publicar: publicarCon(exito({ estado: 'actualizada', version: 5, antes: antes() })),
      ...comun,
    });
    const evento = auditar.mock.calls.at(-1)![0] as { diff: { antes: Record<string, unknown>; despues: Record<string, unknown> } };
    expect(JSON.stringify(evento.diff)).not.toContain('<p>');
    expect(evento.diff.antes).toMatchObject({ title: 'Política de datos', version: 4 });
    expect(evento.diff.despues).toMatchObject({ title: 'Nuevo título', version: 5 });
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
