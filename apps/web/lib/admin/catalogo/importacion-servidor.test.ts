import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar, revalidar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true), revalidar: vi.fn() }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));
vi.mock('next/cache', () => ({ revalidateTag: revalidar }));
vi.mock('@/lib/admin/media/registrar', () => ({ subirImagen: vi.fn() }));

import type { FilaImportacion, ResultadoImportarCatalogo } from '@/lib/db/admin-catalogo';
import { clienteFalso } from '../crud/cliente-falso';
import { COLUMNAS } from './importacion';
import { adjuntarImagenesPorSku, exportarCatalogo, MENSAJE_ARCHIVADO, procesarImportacion } from './importacion-servidor';

const comun = { actor: 'u1', ip: null };
const fila = (o: Record<string, string>) => COLUMNAS.map((c) => o[c] ?? '');
const tabla = (...filas: Record<string, string>[]) => [[...COLUMNAS], ...filas.map(fila)];

const catalogoBase = {
  'brands.select': { data: [{ id: 'b1', name: 'Izao', slug: 'izao' }] },
};

const ok = (extra: Partial<Extract<ResultadoImportarCatalogo, { ok: true }>> = {}): ResultadoImportarCatalogo => ({
  ok: true, modo: 'simular', creados: 0, actualizados: 0, sin_cambios: 0, errores: [], cambios: [], ...extra,
});

beforeEach(() => {
  auditar.mockClear();
  revalidar.mockClear();
});

describe('procesarImportacion', () => {
  it('simular no audita ni invalida, y traduce cambios y errores a filas del archivo', async () => {
    const { cliente } = clienteFalso(catalogoBase);
    const importar = vi.fn(async (_m: 'simular' | 'aplicar', _f: FilaImportacion[]) =>
      ok({
        creados: 1,
        errores: [{ indice: 1, sku: 'B1', motivo: 'sku_duplicado', detalle: 'B1 usado por otro producto' }],
        cambios: [{ indice: 0, tipo: 'crear', campos: ['product', 'variants'] }],
      }),
    );
    const r = await procesarImportacion({
      modo: 'simular',
      cliente,
      importar,
      tabla: tabla({ sku: 'A1', producto_slug: 'uno', nombre: 'Uno' }, { sku: 'B1', producto_slug: 'dos', nombre: 'Dos' }, { sku: 'C1', producto_slug: 'tres', marca: 'Nadie' }),
      ...comun,
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(importar.mock.calls[0]![1]).toHaveLength(2);
    expect(r).toMatchObject({ productos: 2, creados: 1, omitidos: 2 });
    expect(r.cambios).toEqual([{ slug: 'uno', filas: [2], tipo: 'crear', campos: ['product', 'variants'] }]);
    expect(r.errores.map((e) => `${e.fila}:${e.sku}`)).toEqual(['3:B1', '4:C1']);
    expect(auditar).not.toHaveBeenCalled();
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('aplicar audita un solo evento sin datos de productos e invalida catálogo y fichas', async () => {
    const { cliente } = clienteFalso({ ...catalogoBase, 'products.select': { data: [{ id: 'p1' }] } });
    const r = await procesarImportacion({
      modo: 'aplicar',
      cliente,
      importar: async () => ok({ modo: 'aplicar', creados: 1 }),
      tabla: tabla({ sku: 'A1', producto_slug: 'uno', nombre: 'Uno' }),
      ...comun,
    });
    expect('error' in r).toBe(false);
    expect(auditar).toHaveBeenCalledOnce();
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'catalogo.importado', actor: 'u1', diff: { despues: { creados: 1 } } });
    expect(revalidar).toHaveBeenCalledWith('catalog:CO');
    expect(revalidar).toHaveBeenCalledWith('catalog:EC');
    expect(revalidar).toHaveBeenCalledWith('product:p1');
  });

  it('ignora los productos archivados: no los envía a la base y los reporta (D-055)', async () => {
    const { cliente } = clienteFalso({
      ...catalogoBase,
      // El único producto archivado del archivo es «uno» (por URL).
      'products.select': { data: [{ slug: 'uno' }] },
    });
    const importar = vi.fn(async (_m: 'simular' | 'aplicar', _f: FilaImportacion[]) => ok({ creados: 1 }));
    const r = await procesarImportacion({
      modo: 'aplicar',
      cliente,
      importar,
      tabla: tabla({ sku: 'A1', producto_slug: 'uno', nombre: 'Uno' }, { sku: 'B1', producto_slug: 'dos', nombre: 'Dos' }),
      ...comun,
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(importar.mock.calls[0]![1]).toHaveLength(1);
    expect(r.omitidos).toBe(1);
    expect(r.errores).toEqual([{ fila: 2, sku: 'A1', mensaje: MENSAJE_ARCHIVADO }]);
  });

  it('un SKU que pertenece a un producto archivado también se ignora', async () => {
    const { cliente } = clienteFalso({ ...catalogoBase, 'product_variants.select': { data: [{ sku: 'B1' }] } });
    const importar = vi.fn(async (_m: 'simular' | 'aplicar', _f: FilaImportacion[]) => ok());
    const r = await procesarImportacion({
      modo: 'simular',
      cliente,
      importar,
      tabla: tabla({ sku: 'B1', producto_slug: 'dos', nombre: 'Dos' }),
      ...comun,
    });
    expect('error' in r).toBe(false);
    expect(importar).not.toHaveBeenCalled();
  });

  it('procesa en lotes de 200 productos', async () => {
    const { cliente } = clienteFalso(catalogoBase);
    const importar = vi.fn(async () => ok());
    const filas = Array.from({ length: 450 }, (_, i) => ({ sku: `S${i}`, producto_slug: `p-${i}`, nombre: `P${i}` }));
    await procesarImportacion({ modo: 'simular', cliente, importar, tabla: tabla(...filas), ...comun });
    expect(importar.mock.calls.map((c) => (c as unknown as [string, unknown[]])[1].length)).toEqual([200, 200, 50]);
  });

  it('un fallo de la RPC en un lote se reporta sin filtrar detalles', async () => {
    const { cliente } = clienteFalso(catalogoBase);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await procesarImportacion({
      modo: 'simular',
      cliente,
      importar: async () => {
        throw new Error('relation "secreta" does not exist');
      },
      tabla: tabla({ sku: 'A1', producto_slug: 'uno', nombre: 'Uno' }),
      ...comun,
    });
    err.mockRestore();
    expect(r).toMatchObject({ omitidos: 1 });
    expect(JSON.stringify(r)).not.toContain('secreta');
  });

  it('errores de formato del archivo', async () => {
    const { cliente } = clienteFalso(catalogoBase);
    expect(await procesarImportacion({ modo: 'simular', cliente, tabla: [['nombre'], ['x']], ...comun })).toMatchObject({ error: expect.stringMatching(/sku/) });
    expect(await procesarImportacion({ modo: 'simular', cliente, tabla: [['sku']], ...comun })).toMatchObject({ error: expect.stringMatching(/filas/) });
  });
});

describe('exportarCatalogo', () => {
  it('devuelve el encabezado y una fila por variante, sin los productos archivados', async () => {
    const { cliente, filtros } = clienteFalso({
      'brands.select': { data: [{ id: 'b1', name: 'Izao' }] },
      'products.select': {
        data: [{
          id: 'p1', name: 'Rosa', slug: 'rosa', short_description: null, description_html: null, brand_id: 'b1', gender_id: null, family_id: null,
          concentration_id: null, notes_top: [], notes_heart: [], notes_base: [], occasion: [], season: [], longevity: null, sillage: null,
          seo_title: null, seo_description: null, status: 'draft',
        }],
      },
      'product_variants.select': {
        data: [{
          product_id: 'p1', id: 'v1', sku: 'ROSA-1', option_value_ids: [], weight_kg: '0.5', is_default: true,
          image_id: null, sort_order: 0,
          variant_countries: [{ country_code: 'CO', is_active: true, price: 90000, compare_at_price: null, cost: null, stock: 2, low_stock_threshold: null, mastershop_product_id: null, mastershop_variant_id: null }],
        }],
      },
    });
    const filas = await exportarCatalogo(cliente);
    expect(filtros).toContainEqual({ tabla: 'products', metodo: 'neq', args: ['status', 'archived'] });
    expect(filas).toHaveLength(2);
    expect(filas[1]![COLUMNAS.indexOf('sku')]).toBe('ROSA-1');
    expect(filas[1]![COLUMNAS.indexOf('marca')]).toBe('Izao');
    expect(filas[1]![COLUMNAS.indexOf('precio_co')]).toBe('90000');
  });
});

describe('adjuntarImagenesPorSku', () => {
  const img = (nombre: string) => ({ nombre, datos: Buffer.from('x') });
  const variantes = { 'product_variants.select': { data: [{ sku: 'A-1', product_id: 'p1', products: { name: 'Rosa', slug: 'rosa' } }] } };

  it('sube, fusiona con las existentes y guarda solo la sección de imágenes', async () => {
    const { cliente } = clienteFalso({
      ...variantes,
      'product_images.select': { data: [{ media_id: 'viejo', role: 'primary', sort_order: 0 }] },
    });
    let n = 0;
    const subir = vi.fn(async () => ({ ok: true as const, media: { id: `m${++n}`, kind: 'product', width: 1, height: 1, variants: {}, lqip: '', alt: 'Rosa' } }));
    const guardar = vi.fn(async (_e: unknown) => ({ ok: true as const, product_id: 'p1', creado: false }));
    const r = await adjuntarImagenesPorSku({ archivos: [img('A-1_1.jpg'), img('A-1_2.jpg'), img('Z-9_1.jpg'), img('foto.jpg')], cliente, subir, guardar, ...comun });
    expect(r.asignadas).toEqual([{ sku: 'A-1', posicion: 1 }, { sku: 'A-1', posicion: 2 }]);
    expect(r.errores.map((e) => e.archivo).sort()).toEqual(['Z-9_1.jpg', 'foto.jpg']);
    expect((subir.mock.calls as unknown as [unknown][])[0]![0]).toMatchObject({ datos: { kind: 'product', alt: 'Rosa', recorte45: true } });
    const enviado = guardar.mock.calls[0]![0] as { product: Record<string, unknown>; images: unknown[] };
    expect(enviado.product).toEqual({ id: 'p1', name: 'Rosa', slug: 'rosa' });
    expect(enviado.images).toEqual([
      { media_id: 'm1', role: 'primary', sort_order: 0 },
      { media_id: 'm2', role: 'hover', sort_order: 1 },
    ]);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'productos.imagenes_masivas', entidadId: 'p1' }));
    expect(revalidar).toHaveBeenCalledWith('product:p1');
  });

  it('si falla la subida no toca el producto', async () => {
    const { cliente } = clienteFalso(variantes);
    const guardar = vi.fn();
    const r = await adjuntarImagenesPorSku({
      archivos: [img('A-1_1.jpg')],
      cliente,
      subir: async () => ({ ok: false as const, error: 'No se pudo leer la imagen.' }),
      guardar,
      ...comun,
    });
    expect(guardar).not.toHaveBeenCalled();
    expect(r.errores).toEqual([{ archivo: 'A-1_1.jpg', mensaje: 'No se pudo leer la imagen.' }]);
  });
});
