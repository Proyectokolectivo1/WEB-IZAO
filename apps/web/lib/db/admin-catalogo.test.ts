import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { fijarClienteDbParaPruebas } from './cliente';
import { guardarProducto, importarCatalogo } from './admin-catalogo';

const ID = 'a2000000-0000-0000-0000-000000000030';

function clienteFalso(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('guardarProducto', () => {
  it('envía el payload validado en p y devuelve el resultado', async () => {
    const rpc = clienteFalso({ ok: true, product_id: ID, creado: true });
    const r = await guardarProducto({
      product: { name: 'Uno', slug: 'uno', status: 'draft' },
      variants: [{ id: ID, sku: 'U-1', is_default: true, countries: [{ country_code: 'CO', price: 120000, stock: 3 }] }],
    });
    expect(r).toEqual({ ok: true, product_id: ID, creado: true });
    expect(rpc.mock.calls[0]?.[0]).toBe('admin_guardar_producto');
    expect(rpc.mock.calls[0]?.[1].p.variants[0].countries[0].price).toBe(120000);
  });

  it('devuelve el motivo de rechazo de la base', async () => {
    clienteFalso({ ok: false, motivo: 'variante_con_pedidos', detalle: 'U-1' });
    const r = await guardarProducto({ product: { name: 'Uno', slug: 'uno' } });
    expect(r).toMatchObject({ ok: false, motivo: 'variante_con_pedidos' });
  });

  it('rechaza un slug inválido o un precio decimal antes de llamar a la base', async () => {
    const rpc = clienteFalso({ ok: true, product_id: ID, creado: false });
    await expect(guardarProducto({ product: { name: 'Uno', slug: 'Uno Malo' } })).rejects.toThrow();
    await expect(
      guardarProducto({
        product: { name: 'Uno', slug: 'uno' },
        variants: [{ id: ID, sku: 'U-1', countries: [{ country_code: 'CO', price: 10.5 }] }],
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('importarCatalogo', () => {
  it('envía modo y filas y valida el reporte', async () => {
    const rpc = clienteFalso({
      ok: true,
      modo: 'simular',
      creados: 1,
      actualizados: 0,
      sin_cambios: 0,
      errores: [{ indice: 1, sku: 'X', motivo: 'sku_duplicado', detalle: 'X' }],
      cambios: [{ indice: 0, tipo: 'crear', campos: ['product', 'variants'] }],
    });
    const r = await importarCatalogo('simular', [
      { product: { slug: 'nuevo', name: 'Nuevo' }, variants: [{ sku: 'N-1', option_values: [{ option: 'Presentación', value: '30 ml' }] }] },
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p: { modo: 'simular' } });
    expect(r.ok && r.errores[0]?.motivo).toBe('sku_duplicado');
  });
});
