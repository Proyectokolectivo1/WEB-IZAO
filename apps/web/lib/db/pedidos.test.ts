import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { transicionar } from '@izao/core/order-state';
import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { aplicarEventoPedidoDb, aplicarTransicionPedidoDb } from './pedidos';

const ID = 'd3000000-0000-0000-0000-000000000001';
const EV = 'e3000000-0000-0000-0000-000000000001';

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('aplicarTransicionPedidoDb', () => {
  it('envía el evento de transicionar con las fechas en ISO', async () => {
    const rpc = clienteFalso({ ok: true, order_id: ID, from_status: 'pendiente_pago', to_status: 'pagado', event_id: EV });
    const t = transicionar({ from: 'pendiente_pago', to: 'pagado', actor: 'webhook:wompi', payload: { payment_id: 'p1' } });
    if (!t.ok) throw new Error('transición inválida');
    const r = await aplicarEventoPedidoDb(ID, t.event, { paid_at: new Date('2026-10-20T15:00:00.000Z') });
    expect(r).toMatchObject({ ok: true, event_id: EV });
    expect(rpc).toHaveBeenCalledWith('aplicar_transicion_pedido', {
      p: {
        order_id: ID,
        from_status: 'pendiente_pago',
        to_status: 'pagado',
        actor: 'webhook:wompi',
        payload: { payment_id: 'p1' },
        fechas: { paid_at: '2026-10-20T15:00:00.000Z' },
      },
    });
  });

  it('devuelve estado_cambiado con el estado actual', async () => {
    clienteFalso({ ok: false, motivo: 'estado_cambiado', status_actual: 'pagado' });
    const r = await aplicarTransicionPedidoDb({ order_id: ID, from_status: 'pendiente_pago', to_status: 'pagado', actor: 'system' });
    expect(r).toEqual({ ok: false, motivo: 'estado_cambiado', status_actual: 'pagado' });
  });

  it('rechaza actor, estado o fecha inválidos antes de llamar', async () => {
    const rpc = clienteFalso(null);
    const base = { order_id: ID, from_status: 'pendiente_pago', to_status: 'pagado', actor: 'system' } as const;
    await expect(aplicarTransicionPedidoDb({ ...base, actor: 'intruso' })).rejects.toThrow();
    await expect(aplicarTransicionPedidoDb({ ...base, to_status: 'volando' as never })).rejects.toThrow();
    await expect(aplicarTransicionPedidoDb({ ...base, fechas: { status: 'x' } as never })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lanza ErrorDb si la base falla', async () => {
    clienteFalso(null, { message: 'x', code: '40001' });
    await expect(
      aplicarTransicionPedidoDb({ order_id: ID, from_status: 'pendiente_pago', to_status: 'pagado', actor: 'system' }),
    ).rejects.toBeInstanceOf(ErrorDb);
  });
});
