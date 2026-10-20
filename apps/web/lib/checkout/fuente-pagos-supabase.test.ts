import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { transicionar } from '@izao/core/order-state';
import { fijarClienteDbParaPruebas } from '@/lib/db/cliente';
import { fuentePagosSupabase } from './fuente-pagos-supabase';

const O = '00000000-0000-4000-8000-000000000001';
const E = '00000000-0000-4000-8000-0000000000e1';

afterEach(() => fijarClienteDbParaPruebas(null));

function conRpc(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const from = vi.fn(() => {
    throw new Error('no debe tocar tablas: la transición es una RPC');
  });
  fijarClienteDbParaPruebas({ rpc, from } as never);
  return rpc;
}

describe('fuente de pagos Supabase: aplicarTransicion por aplicar_transicion_pedido', () => {
  const t = transicionar({ from: 'pago_rechazado', to: 'pendiente_pago', actor: 'system', payload: { motivo: 'reintento_pago' } });
  if (!t.ok) throw new Error('transición inválida');

  it('una sola RPC atómica con el evento de transicionar; ok → true', async () => {
    const rpc = conRpc({ ok: true, order_id: O, from_status: 'pago_rechazado', to_status: 'pendiente_pago', event_id: E });
    expect(await fuentePagosSupabase.aplicarTransicion(O, t.event)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('aplicar_transicion_pedido');
    expect(rpc.mock.calls[0]![1]).toEqual({
      p: { order_id: O, from_status: 'pago_rechazado', to_status: 'pendiente_pago', actor: 'system', payload: { motivo: 'reintento_pago' } },
    });
  });

  it('estado_cambiado a otro estado → false', async () => {
    conRpc({ ok: false, motivo: 'estado_cambiado', status_actual: 'expirado' });
    expect(await fuentePagosSupabase.aplicarTransicion(O, t.event)).toBe(false);
  });

  it('estado_cambiado con status_actual = to_status → ya aplicado (true)', async () => {
    conRpc({ ok: false, motivo: 'estado_cambiado', status_actual: 'pendiente_pago' });
    expect(await fuentePagosSupabase.aplicarTransicion(O, t.event)).toBe(true);
  });

  it.each([[{ ok: false, motivo: 'pedido_inexistente' }], [{ ok: false, motivo: 'datos_invalidos', detalle: 'mismo_estado' }]])(
    '%j → lanza',
    async (data) => {
      conRpc(data);
      await expect(fuentePagosSupabase.aplicarTransicion(O, t.event)).rejects.toThrow('aplicar_transicion_pedido');
    },
  );
});
