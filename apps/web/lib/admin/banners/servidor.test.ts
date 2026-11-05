import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));

import { clienteFalso } from '../crud/cliente-falso';
import { esquemaBanner } from './banners';
import {
  alternarBannerBd,
  buscarProductosVisibles,
  destinoEditable,
  eliminarBannerBd,
  guardarBannerBd,
  moverBannerBd,
  normalizarBusqueda,
  resolverDestinoBd,
} from './servidor';

const D = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const V = '44444444-4444-4444-8444-444444444444';
const C = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const comun = { actor: 'u1', ip: null };
const BASE = { country_code: 'CO', placement: 'hero', desktop_media_id: D, mobile_media_id: M, alt: 'Frasco sobre mármol', is_active: 'on' };
const medios = { 'media.select': { data: [{ id: D }, { id: M }] } };

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('guardar banner', () => {
  it('crea al final de la lista del país, audita e invalida solo ese país', async () => {
    const { cliente, llamadas } = clienteFalso({
      ...medios,
      'banners.select': { data: [{ sort_order: 30 }] },
      'banners.insert': { data: { id: 'b1' } },
    });
    const datos = esquemaBanner.parse({ ...BASE, country_code: 'EC' });
    const r = await guardarBannerBd({ cliente, datos, ...comun });
    expect(r).toEqual({ ok: true, id: 'b1' });
    const fila = llamadas.find((l) => l.clave === 'banners.insert')?.args[0] as Record<string, unknown>;
    expect(fila).toMatchObject({ country_code: 'EC', sort_order: 40, link_url: null, is_active: true });
    expect(revalidar).toHaveBeenCalledWith('content:EC');
    expect(revalidar).not.toHaveBeenCalledWith('content:CO');
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'banners.creado', entidad: 'banners', entidadId: 'b1' }));
  });

  it('con producto y variante guarda la ruta de compra del país', async () => {
    const { cliente, llamadas } = clienteFalso({
      ...medios,
      'catalog_listing.select': { data: { slug: 'aventus', is_visible: true } },
      'product_variants.select': { data: [{ id: V, sku: 'AVT-100', option_value_ids: [] }] },
      'banners.select': { data: [] },
      'banners.insert': { data: { id: 'b2' } },
    });
    const datos = esquemaBanner.parse({ ...BASE, destino_tipo: 'producto', destino_producto_id: P, destino_variante_id: V });
    expect((await guardarBannerBd({ cliente, datos, ...comun })).ok).toBe(true);
    const fila = llamadas.find((l) => l.clave === 'banners.insert')?.args[0] as Record<string, unknown>;
    expect(fila.link_url).toBe('/co/perfume/aventus?variante=AVT-100');
    expect(fila.sort_order).toBe(10);
  });

  it('rechaza un producto que no está visible en el país y no escribe nada', async () => {
    const { cliente, llamadas } = clienteFalso({ ...medios, 'catalog_listing.select': { data: { slug: 'aventus', is_visible: false } } });
    const datos = esquemaBanner.parse({ ...BASE, destino_tipo: 'producto', destino_producto_id: P });
    const r = await guardarBannerBd({ cliente, datos, ...comun });
    expect(r).toMatchObject({ ok: false, errores: { destino_producto_id: expect.stringContaining('Colombia') } });
    expect(llamadas.some((l) => l.clave === 'banners.insert')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('rechaza una variante que no es del producto o no está activa en el país', async () => {
    const { cliente } = clienteFalso({
      ...medios,
      'catalog_listing.select': { data: { slug: 'aventus', is_visible: true } },
      'product_variants.select': { data: [] },
    });
    const datos = esquemaBanner.parse({ ...BASE, destino_tipo: 'producto', destino_producto_id: P, destino_variante_id: V });
    const r = await guardarBannerBd({ cliente, datos, ...comun });
    expect(r).toMatchObject({ ok: false, errores: { destino_variante_id: expect.any(String) } });
  });

  it('categoría: debe estar visible en el país', async () => {
    const visible = clienteFalso({
      ...medios,
      'category_countries.select': { data: [{ categories: { id: C, slug: 'para-ella', name: 'Para ella', sort_order: 1 } }] },
      'banners.select': { data: [] },
      'banners.insert': { data: { id: 'b3' } },
    });
    const datos = esquemaBanner.parse({ ...BASE, destino_tipo: 'categoria', destino_categoria_id: C });
    expect((await guardarBannerBd({ cliente: visible.cliente, datos, ...comun })).ok).toBe(true);
    const fila = visible.llamadas.find((l) => l.clave === 'banners.insert')?.args[0] as Record<string, unknown>;
    expect(fila.link_url).toBe('/co/categoria/para-ella');
    const oculta = clienteFalso({ ...medios, 'category_countries.select': { data: [] } });
    expect(await guardarBannerBd({ cliente: oculta.cliente, datos, ...comun })).toMatchObject({ ok: false });
  });

  it('una imagen que ya no existe se avisa en su campo', async () => {
    const { cliente } = clienteFalso({ 'media.select': { data: [{ id: D }] } });
    const r = await guardarBannerBd({ cliente, datos: esquemaBanner.parse(BASE), ...comun });
    expect(r).toMatchObject({ ok: false, errores: { desktop_media_id: expect.any(String) } });
  });

  it('editar guarda el diff e invalida el país nuevo y el anterior', async () => {
    const { cliente, llamadas } = clienteFalso({
      ...medios,
      'banners.select': [
        { data: { id: B, country_code: 'CO', placement: 'hero', alt: 'Antes', sort_order: 20 } },
        { data: [{ sort_order: 10 }] },
      ],
      'banners.update': { data: null },
    });
    const datos = esquemaBanner.parse({ ...BASE, id: B, country_code: 'EC' });
    const r = await guardarBannerBd({ cliente, datos, ...comun });
    expect(r.ok).toBe(true);
    const cambios = llamadas.find((l) => l.clave === 'banners.update')?.args[0] as Record<string, unknown>;
    expect(cambios).toMatchObject({ country_code: 'EC', sort_order: 20 }); // cambia de país: va al final de la lista nueva
    expect(revalidar).toHaveBeenCalledWith('content:EC');
    expect(revalidar).toHaveBeenCalledWith('content:CO');
    const evento = auditar.mock.calls[0]?.[0] as { accion: string; diff: { antes: Record<string, unknown> } };
    expect(evento.accion).toBe('banners.actualizado');
    expect(evento.diff.antes).toMatchObject({ country_code: 'CO', alt: 'Antes' });
  });
});

describe('orden, activación y borrado', () => {
  it('mover renumera de 10 en 10 y solo escribe lo que cambia', async () => {
    const { cliente, llamadas } = clienteFalso({
      'banners.select': [
        { data: { country_code: 'CO', placement: 'hero' } },
        { data: [{ id: 'a', sort_order: 10 }, { id: 'b', sort_order: 20 }, { id: 'c', sort_order: 30 }] },
      ],
      'banners.update': { data: null },
    });
    const r = await moverBannerBd({ cliente, id: 'c', direccion: 'arriba', ...comun });
    expect(r.ok).toBe(true);
    const escrituras = llamadas.filter((l) => l.clave === 'banners.update').map((l) => l.args[0]);
    expect(escrituras).toEqual([{ sort_order: 20 }, { sort_order: 30 }]); // c pasa a 20 y b a 30; a no cambia
    expect(revalidar).toHaveBeenCalledWith('content:CO');
  });

  it('activar y desactivar auditan el antes y el después', async () => {
    const { cliente } = clienteFalso({ 'banners.select': { data: { country_code: 'EC', is_active: true } }, 'banners.update': { data: null } });
    expect((await alternarBannerBd({ cliente, id: 'b1', activo: false, ...comun })).ok).toBe(true);
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'banners.desactivado', diff: { antes: { is_active: true }, despues: { is_active: false } } }),
    );
    expect(revalidar).toHaveBeenCalledWith('content:EC');
  });

  it('eliminar audita lo borrado; si ya no existe no falla', async () => {
    const { cliente, llamadas } = clienteFalso({
      'banners.select': { data: { id: 'b1', country_code: 'CO', alt: 'x' } },
      'banners.delete': { data: null },
    });
    expect((await eliminarBannerBd({ cliente, id: 'b1', ...comun })).ok).toBe(true);
    expect(llamadas.some((l) => l.clave === 'banners.delete')).toBe(true);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'banners.eliminado' }));
    const vacio = clienteFalso({ 'banners.select': { data: null } });
    expect((await eliminarBannerBd({ cliente: vacio.cliente, id: 'x', ...comun })).ok).toBe(true);
  });
});

describe('selector de productos y reconstrucción del destino', () => {
  it('busca solo productos visibles en el país, sin tildes ni comodines', async () => {
    const { cliente, filtros } = clienteFalso({
      'catalog_listing.select': {
        data: [{ product_id: P, slug: 'aventus', name: 'Aventús', brand_name: 'Casa', img_primary: { variants: { '800': 'a-800.webp', '400': 'a-400.webp' } } }],
      },
    });
    const r = await buscarProductosVisibles(cliente, 'EC', 'Aventús%');
    expect(r).toEqual([{ id: P, slug: 'aventus', name: 'Aventús', brand: 'Casa', ruta: 'a-400.webp' }]);
    expect(filtros).toContainEqual({ tabla: 'catalog_listing', metodo: 'eq', args: ['country_code', 'EC'] });
    expect(filtros).toContainEqual({ tabla: 'catalog_listing', metodo: 'eq', args: ['is_visible', true] });
    expect(filtros.find((f) => f.metodo === 'ilike')?.args[1]).toBe('%aventus\\%%');
    expect(normalizarBusqueda('  ÁÉÍ ')).toBe('aei');
    expect(await buscarProductosVisibles(cliente, 'CO', 'a')).toEqual([]);
  });

  it('al editar reconstruye producto y variante desde link_url', async () => {
    const { cliente } = clienteFalso({
      'catalog_listing.select': { data: { product_id: P, slug: 'aventus', name: 'Aventús', brand_name: null } },
      'product_variants.select': { data: [{ id: V, sku: 'AVT-100', option_value_ids: [] }] },
    });
    const d = await destinoEditable(cliente, 'CO', '/co/perfume/aventus?variante=AVT-100');
    expect(d).toMatchObject({ tipo: 'producto', varianteId: V, producto: { id: P, name: 'Aventús' } });
  });

  it('si el producto ya no está visible, conserva la ruta como URL libre', async () => {
    const { cliente } = clienteFalso({ 'catalog_listing.select': { data: null } });
    expect(await destinoEditable(cliente, 'CO', '/co/perfume/viejo')).toMatchObject({ tipo: 'url', url: '/co/perfume/viejo' });
  });

  it('resolverDestinoBd: sin enlace y URL libre no consultan la base', async () => {
    const { cliente, llamadas } = clienteFalso({});
    const base = { country_code: 'CO' as const, destino_producto_id: null, destino_variante_id: null, destino_categoria_id: null, destino_url: '' };
    expect(await resolverDestinoBd(cliente, { ...base, destino_tipo: 'ninguno' })).toEqual({ ok: true, url: null });
    expect(await resolverDestinoBd(cliente, { ...base, destino_tipo: 'url', destino_url: '/co/catalogo' })).toEqual({ ok: true, url: '/co/catalogo' });
    expect(llamadas).toEqual([]);
  });
});
