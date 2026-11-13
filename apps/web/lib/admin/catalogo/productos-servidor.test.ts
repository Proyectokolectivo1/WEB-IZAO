import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar, revalidarRuta } = vi.hoisted(() => ({
  auditar: vi.fn(async (_e: unknown) => true),
  revalidar: vi.fn(),
  revalidarRuta: vi.fn(),
}));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar, revalidatePath: revalidarRuta }));

import type { GuardarProductoEntrada, ResultadoEliminarProducto, ResultadoGuardarProducto } from '@/lib/db/admin-catalogo';
import { clienteFalso } from '../crud/cliente-falso';
import { productoNuevo, type ProductoForm } from './productos';
import {
  archivarProductoBd,
  duplicarProductoBd,
  eliminarProductoBd,
  guardarProductoPanel,
  listarProductos,
  obtenerProductoForm,
  restaurarProductoBd,
} from './productos-servidor';

const comun = { actor: 'u1', ip: null };

function generador(inicio = 0) {
  let n = inicio;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

function formValido(): ProductoForm {
  const f = productoNuevo(generador());
  f.name = 'Oud Nocturno';
  f.slug = 'oud-nocturno';
  f.variants[0]!.sku = 'OUD-100';
  f.variants[0]!.countries[0] = { country_code: 'CO', is_active: true, price: '189.900', compare_at_price: '', cost: '', stock: '5', low_stock_threshold: '', mastershop_product_id: '', mastershop_variant_id: '' };
  return f;
}

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
  revalidarRuta.mockClear();
});

describe('guardarProductoPanel', () => {
  it('guarda, audita la alta e invalida la caché de producto y de los dos países', async () => {
    const { cliente } = clienteFalso({});
    const guardar = vi.fn(async (_e: GuardarProductoEntrada): Promise<ResultadoGuardarProducto> => ({ ok: true, product_id: '00000000-0000-4000-8000-0000000000aa', creado: true }));
    const r = await guardarProductoPanel({ form: formValido(), cliente, guardar, ...comun });
    expect(r).toEqual({ ok: true, id: '00000000-0000-4000-8000-0000000000aa' });
    expect(guardar).toHaveBeenCalledOnce();
    expect(guardar.mock.calls[0]![0].variants![0]!.countries![0]).toMatchObject({ country_code: 'CO', price: '189900' });
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'productos.creado', entidad: 'products', actor: 'u1' }));
    expect(revalidar).toHaveBeenCalledWith('product:00000000-0000-4000-8000-0000000000aa');
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
    expect(revalidar).toHaveBeenCalledWith('catalog:EC');
  });

  it('no llama a la base ni audita si el formulario es inválido', async () => {
    const { cliente } = clienteFalso({});
    const guardar = vi.fn();
    const f = formValido();
    f.variants[0]!.sku = '';
    const r = await guardarProductoPanel({ form: f, cliente, guardar, ...comun });
    expect(r).toMatchObject({ ok: false, errores: { 'variants.0.sku': expect.any(String) } });
    expect(guardar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('traduce los motivos de la base a errores por campo y no invalida', async () => {
    const { cliente } = clienteFalso({});
    const guardar = async (): Promise<ResultadoGuardarProducto> => ({ ok: false, motivo: 'sku_duplicado', detalle: 'OUD-100' });
    const r = await guardarProductoPanel({ form: formValido(), cliente, guardar, ...comun });
    expect(r).toMatchObject({ ok: false, errores: { 'variants.0.sku': expect.any(String) } });
    const r2 = await guardarProductoPanel({
      form: formValido(),
      cliente,
      guardar: async () => ({ ok: false, motivo: 'slug_duplicado', detalle: null }),
      ...comun,
    });
    expect(r2).toMatchObject({ ok: false, errores: { slug: expect.any(String) } });
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('el motivo de variante con pedidos da un mensaje claro', async () => {
    const { cliente } = clienteFalso({});
    const r = await guardarProductoPanel({
      form: formValido(),
      cliente,
      guardar: async () => ({ ok: false, motivo: 'variante_con_pedidos', detalle: null }),
      ...comun,
    });
    expect(r.ok === false && r.mensaje).toMatch(/pedidos/);
  });

  it('un fallo inesperado de la RPC no filtra detalles técnicos', async () => {
    const { cliente } = clienteFalso({});
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await guardarProductoPanel({
      form: formValido(),
      cliente,
      guardar: async () => {
        throw new Error('relation "secreto" does not exist');
      },
      ...comun,
    });
    err.mockRestore();
    expect(r).toEqual({ ok: false, mensaje: 'No se pudo guardar el producto. Inténtalo de nuevo.' });
  });

  it('en una edición audita el diff contra el producto anterior', async () => {
    const id = '00000000-0000-4000-8000-0000000000bb';
    const { cliente } = clienteFalso({ 'products.select': { data: { id, name: 'Viejo', slug: 'oud-nocturno', status: 'draft' } } });
    const f = { ...formValido(), id, status: 'draft' as const };
    await guardarProductoPanel({
      form: f,
      cliente,
      guardar: async () => ({ ok: true, product_id: id, creado: false }),
      ...comun,
    });
    const evento = auditar.mock.calls[0]![0] as { accion: string; diff: { antes: Record<string, unknown>; despues: Record<string, unknown> } };
    expect(evento.accion).toBe('productos.actualizado');
    expect(evento.diff.antes).toMatchObject({ name: 'Viejo' });
    expect(evento.diff.despues).toMatchObject({ name: 'Oud Nocturno' });
  });
});

describe('archivarProductoBd', () => {
  it('manda solo el estado archivado y conserva nombre y URL', async () => {
    const id = '00000000-0000-4000-8000-0000000000cc';
    const { cliente } = clienteFalso({ 'products.select': { data: { id, name: 'Rosa', slug: 'rosa', status: 'active' } } });
    const guardar = vi.fn(async (_e: GuardarProductoEntrada): Promise<ResultadoGuardarProducto> => ({ ok: true, product_id: id, creado: false }));
    const r = await archivarProductoBd({ id, cliente, guardar, ...comun });
    expect(r.ok).toBe(true);
    expect(guardar.mock.calls[0]![0]).toEqual({ product: { id, name: 'Rosa', slug: 'rosa', status: 'archived' } });
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
  });

  it('si ya estaba archivado no hace nada', async () => {
    const { cliente } = clienteFalso({ 'products.select': { data: { id: 'x', name: 'R', slug: 'r', status: 'archived' } } });
    const guardar = vi.fn();
    expect((await archivarProductoBd({ id: 'x', cliente, guardar, ...comun })).ok).toBe(true);
    expect(guardar).not.toHaveBeenCalled();
  });

  it('un producto inexistente se informa', async () => {
    const { cliente } = clienteFalso({});
    expect(await archivarProductoBd({ id: 'x', cliente, guardar: vi.fn(), ...comun })).toMatchObject({ ok: false });
  });
});

describe('duplicarProductoBd', () => {
  const id = '00000000-0000-4000-8000-0000000000dd';
  const respuestas = {
    'products.select': {
      data: {
        id, name: 'Rosa', slug: 'rosa', short_description: null, description_html: null, brand_id: null, gender_id: null,
        family_id: null, concentration_id: null, notes_top: [], notes_heart: [], notes_base: [], occasion: [], season: [],
        longevity: null, sillage: null, seo_title: null, seo_description: null, status: 'active',
      },
    },
    'product_variants.select': {
      data: [{
        id: '00000000-0000-4000-8000-0000000000de', sku: 'ROSA-1', option_value_ids: [], weight_kg: '0.500', is_default: true,
        image_id: null, sort_order: 0,
        variant_countries: [{ country_code: 'EC', is_active: true, price: 4990, compare_at_price: null, cost: null, stock: 3, low_stock_threshold: null, mastershop_product_id: 55, mastershop_variant_id: 56 }],
      }],
    },
    'product_countries.select': { data: [{ country_code: 'EC', is_visible: true, is_featured: false, featured_rank: null, badges: [] }] },
  };

  it('crea un borrador sin vínculo y sin visibilidad', async () => {
    const { cliente } = clienteFalso(respuestas);
    const guardar = vi.fn(async (_e: GuardarProductoEntrada): Promise<ResultadoGuardarProducto> => ({ ok: true, product_id: 'nuevo', creado: true }));
    const r = await duplicarProductoBd({ id, nuevoId: generador(900), cliente, guardar, ...comun });
    expect(r).toEqual({ ok: true, id: 'nuevo' });
    const e = guardar.mock.calls[0]![0];
    expect(e.product).toMatchObject({ slug: 'rosa-copia', status: 'draft' });
    expect(e.product.id).toBeUndefined();
    expect(e.countries!.every((c) => !c.is_visible)).toBe(true);
    expect(e.variants![0]).toMatchObject({ sku: 'ROSA-1-COPIA' });
    expect(e.variants![0]!.countries![0]).toMatchObject({ country_code: 'EC', mastershop_product_id: null, mastershop_variant_id: null });
  });

  it('reintenta con otro sufijo si la URL ya existe', async () => {
    const { cliente } = clienteFalso(respuestas);
    const guardar = vi.fn()
      .mockResolvedValueOnce({ ok: false, motivo: 'slug_duplicado', detalle: 'rosa-copia' })
      .mockResolvedValueOnce({ ok: true, product_id: 'nuevo2', creado: true });
    const r = await duplicarProductoBd({ id, nuevoId: generador(900), cliente, guardar, ...comun });
    expect(r).toEqual({ ok: true, id: 'nuevo2' });
    expect(guardar.mock.calls[1]![0].product.slug).toBe('rosa-copia-2');
  });
});

describe('listarProductos / obtenerProductoForm', () => {
  it('sin resultados de búsqueda devuelve la lista vacía sin más consultas', async () => {
    const { cliente, llamadas } = clienteFalso({});
    const r = await listarProductos(cliente, { q: 'zzz', estado: '', marca: '', pais: '', pagina: 1 });
    expect(r).toEqual({ filas: [], total: 0 });
    expect(llamadas.filter((l) => l.clave === 'products.select')).toHaveLength(2);
  });

  it('arma la fila con marca, precio desde y stock por país', async () => {
    const { cliente } = clienteFalso({
      'products.select': {
        count: 1,
        data: [{ id: 'p1', name: 'Rosa', slug: 'rosa', status: 'active', updated_at: '2026-10-20T00:00:00Z', brands: { name: 'Izao' } }],
      },
      'product_variants.select': { data: [{ product_id: 'p1', variant_countries: [{ country_code: 'CO', is_active: true, price: 90000, stock: 4 }] }] },
      'product_countries.select': { data: [{ product_id: 'p1', country_code: 'CO', is_visible: true }] },
      'product_images.select': { data: [{ product_id: 'p1', media: { variants: { '400': 'p/1.webp' } } }] },
    });
    const r = await listarProductos(cliente, { q: '', estado: 'active', marca: '', pais: 'CO', pagina: 1 });
    expect(r.total).toBe(1);
    expect(r.filas[0]).toMatchObject({ marca: 'Izao', imagen: 'p/1.webp', variantes: 1 });
    expect(r.filas[0]!.paises.CO).toEqual({ visible: true, precioDesde: 90000n, stock: 4, variantesActivas: 1 });
  });

  it('un producto que no existe devuelve null', async () => {
    const { cliente } = clienteFalso({});
    expect(await obtenerProductoForm(cliente, '00000000-0000-4000-8000-0000000000ee')).toBeNull();
  });
});

describe('eliminarProductoBd (D-055)', () => {
  const id = '00000000-0000-4000-8000-0000000000ee';
  const base = { ok: true as const, name: 'Rosa', slug: 'rosa', skus: ['ROSA-50'] };
  const rpc = (r: ResultadoEliminarProducto) => vi.fn(async (_id: string) => r);
  const { cliente } = clienteFalso({});

  it('sin pedidos: elimina, audita quién y qué, e invalida ficha, listados y sitemap', async () => {
    const eliminar = rpc({ ...base, accion: 'eliminado', pedidos: 0, variantes: 2, imagenes_borradas: 3 });
    const r = await eliminarProductoBd({ id, cliente, eliminar, ...comun });
    expect(r).toEqual({ ok: true, id, accion: 'eliminado', pedidos: 0 });
    expect(eliminar).toHaveBeenCalledWith(id);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0]![0]).toMatchObject({
      actor: 'u1',
      accion: 'productos.eliminado',
      entidad: 'products',
      entidadId: id,
      diff: { antes: { name: 'Rosa', slug: 'rosa', skus: ['ROSA-50'] }, resumen: { resultado: 'eliminado', pedidos: 0, variantes: 2, imagenes_borradas: 3 } },
    });
    expect(revalidar).toHaveBeenCalledWith(`product:${id}`);
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
    expect(revalidar).toHaveBeenCalledWith('catalog:EC');
    expect(revalidarRuta).toHaveBeenCalledWith('/co/sitemap.xml');
    expect(revalidarRuta).toHaveBeenCalledWith('/ec/sitemap.xml');
  });

  it('con pedidos: la base lo archiva, se audita como archivado y se informa cuántos pedidos', async () => {
    const r = await eliminarProductoBd({ id, cliente, eliminar: rpc({ ...base, accion: 'archivado', pedidos: 3 }), ...comun });
    expect(r).toEqual({ ok: true, id, accion: 'archivado', pedidos: 3 });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'productos.archivado_por_pedidos', diff: { resumen: { resultado: 'archivado', pedidos: 3 } } });
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
  });

  it('ya archivado con pedidos: no vuelve a auditar', async () => {
    const r = await eliminarProductoBd({ id, cliente, eliminar: rpc({ ...base, accion: 'ya_archivado', pedidos: 1 }), ...comun });
    expect(r).toMatchObject({ ok: true, accion: 'ya_archivado' });
    expect(auditar).not.toHaveBeenCalled();
  });

  it('producto inexistente y fallo de la base se informan sin invalidar ni auditar', async () => {
    expect(await eliminarProductoBd({ id, cliente, eliminar: rpc({ ok: false, motivo: 'no_existe' }), ...comun })).toEqual({ ok: false, mensaje: 'Ese producto ya no existe.' });
    const falla = vi.fn(async (_id: string): Promise<ResultadoEliminarProducto> => {
      throw new Error('boom');
    });
    expect(await eliminarProductoBd({ id, cliente, eliminar: falla, ...comun })).toMatchObject({ ok: false });
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });
});

describe('restaurarProductoBd', () => {
  const id = '00000000-0000-4000-8000-0000000000ef';
  it('un archivado vuelve como borrador y se invalida el sitemap', async () => {
    const { cliente } = clienteFalso({ 'products.select': { data: { id, name: 'Rosa', slug: 'rosa', status: 'archived' } } });
    const guardar = vi.fn(async (_e: GuardarProductoEntrada): Promise<ResultadoGuardarProducto> => ({ ok: true, product_id: id, creado: false }));
    expect((await restaurarProductoBd({ id, cliente, guardar, ...comun })).ok).toBe(true);
    expect(guardar.mock.calls[0]![0]).toEqual({ product: { id, name: 'Rosa', slug: 'rosa', status: 'draft' } });
    expect(revalidarRuta).toHaveBeenCalledWith('/co/sitemap.xml');
  });

  it('si no estaba archivado no hace nada', async () => {
    const { cliente } = clienteFalso({ 'products.select': { data: { id, name: 'Rosa', slug: 'rosa', status: 'active' } } });
    const guardar = vi.fn();
    expect((await restaurarProductoBd({ id, cliente, guardar, ...comun })).ok).toBe(true);
    expect(guardar).not.toHaveBeenCalled();
  });
});

describe('listarProductos: archivados', () => {
  it('por defecto excluye los archivados; con el filtro «Archivados» solo esos', async () => {
    const a = clienteFalso({ 'products.select': { data: [], count: 0 } });
    await listarProductos(a.cliente, { q: '', estado: '', marca: '', pais: '', pagina: 1 });
    expect(a.filtros).toContainEqual({ tabla: 'products', metodo: 'neq', args: ['status', 'archived'] });
    const b = clienteFalso({ 'products.select': { data: [], count: 0 } });
    await listarProductos(b.cliente, { q: '', estado: 'archived', marca: '', pais: '', pagina: 1 });
    expect(b.filtros).toContainEqual({ tabla: 'products', metodo: 'eq', args: ['status', 'archived'] });
    expect(b.filtros.some((f) => f.metodo === 'neq')).toBe(false);
  });
});
