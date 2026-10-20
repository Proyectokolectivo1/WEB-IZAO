import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { crearPedidoCheckoutDb, type EntradaCrearPedido } from './checkout';

const ID = 'd2000000-0000-0000-0000-000000000001';
const VAR = 'f2000000-0000-0000-0000-000000000001';

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

const entrada: EntradaCrearPedido = {
  order: {
    country_code: 'CO',
    currency_code: 'COP',
    contact_first_name: 'Ana',
    contact_last_name: 'Paz',
    contact_phone_e164: '+573001112233',
    payment_method: 'wompi',
    subtotal: '100000',
    total_customer: '100000',
    checkout_idempotency_key: 'clave-1',
  },
  items: [
    {
      product_id: null,
      variant_id: VAR,
      sku: 'CK-1',
      name_snapshot: 'Uno',
      variant_label: '100 ml',
      quantity: 1,
      unit_price: '100000',
    },
  ],
};

const resumen = {
  id: ID,
  number: 'IZ-CO-000001',
  public_token: 'abc',
  status: 'pendiente_pago',
  country_code: 'CO',
  currency_code: 'COP',
  payment_method: 'wompi',
  subtotal: '100000',
  discount_amount: '0',
  financing_surcharge_amount: '0',
  total_customer: '100000',
  cod_deposit_amount: '0',
  cod_collect_amount: '0',
  lines: [{ variant_id: VAR, name_snapshot: 'Uno', variant_label: '100 ml', quantity: 1, unit_price: '100000', line_discount: '0' }],
};

describe('crearPedidoCheckoutDb', () => {
  it('envía el payload en p y devuelve el pedido creado', async () => {
    const rpc = clienteFalso({ ok: true, estado: 'creado', repetido: false, order: resumen });
    const r = await crearPedidoCheckoutDb(entrada);
    expect(r).toMatchObject({ ok: true, estado: 'creado', repetido: false, order: { number: 'IZ-CO-000001' } });
    expect(rpc.mock.calls[0]?.[0]).toBe('crear_pedido_checkout');
    expect(rpc.mock.calls[0]?.[1].p.order.checkout_idempotency_key).toBe('clave-1');
  });

  it('devuelve el rechazo con faltantes', async () => {
    clienteFalso({
      ok: false,
      estado: 'rechazado',
      motivo: 'sin_stock',
      faltantes: [{ variant_id: VAR, sku: 'CK-1', solicitado: 1, disponible: 0, motivo: 'stock_insuficiente' }],
    });
    const r = await crearPedidoCheckoutDb(entrada);
    expect(r).toMatchObject({ ok: false, motivo: 'sin_stock', faltantes: [{ disponible: 0 }] });
  });

  it('rechaza montos decimales o sin líneas antes de llamar a la base', async () => {
    const rpc = clienteFalso(null);
    await expect(crearPedidoCheckoutDb({ ...entrada, order: { ...entrada.order, subtotal: 10.5 } })).rejects.toThrow();
    await expect(crearPedidoCheckoutDb({ ...entrada, items: [] })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lanza ErrorDb si la respuesta cambia de forma o la base falla', async () => {
    clienteFalso({ ok: true, estado: 'creado', repetido: false, order: { ...resumen, total_customer: 100000 } });
    await expect(crearPedidoCheckoutDb(entrada)).rejects.toBeInstanceOf(ErrorDb);
    clienteFalso(null, { message: 'x', code: '40001' });
    await expect(crearPedidoCheckoutDb(entrada)).rejects.toBeInstanceOf(ErrorDb);
  });
});
