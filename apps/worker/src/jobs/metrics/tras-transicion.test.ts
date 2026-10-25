import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { OrderStatusEvent } from '@izao/core/order-state';
import { fetchFalso } from '../fetch-falso.js';
import { JOB_METRICS_RECOMPUTE_DAY } from './recalcular-dia.js';
import { conRecalculoMetricas, leerFechasPedidoPostgrest, recalculadorMetricas } from './tras-transicion.js';

const EVENTO: OrderStatusEvent = {
  type: 'status_changed',
  from_status: 'pendiente_pago',
  to_status: 'pagado',
  actor: 'webhook:addi',
  payload: {},
} as OrderStatusEvent;

function fuente(resultado: boolean | Error) {
  const llamadas: unknown[][] = [];
  return {
    llamadas,
    otra: () => 'intacta',
    aplicarTransicion: async (orderId: string, evento: OrderStatusEvent, opciones?: { paid_at?: Date }) => {
      llamadas.push([orderId, evento, opciones]);
      if (resultado instanceof Error) throw resultado;
      return resultado;
    },
  };
}

describe('recalcular métricas tras cada transición del pedido', () => {
  it('transición aplicada → encola el recálculo del pedido y devuelve true; pasa los argumentos sin cambios', async () => {
    const f = fuente(true);
    const recalcular = vi.fn(async () => {});
    const g = conRecalculoMetricas(f, recalcular);
    const paid = new Date('2026-10-20T15:00:00Z');
    expect(await g.aplicarTransicion('o1', EVENTO, { paid_at: paid })).toBe(true);
    expect(f.llamadas).toEqual([['o1', EVENTO, { paid_at: paid }]]);
    expect(recalcular).toHaveBeenCalledWith('o1');
    expect(g.otra()).toBe('intacta');
  });

  it('transición no aplicada (otro proceso movió el pedido) o que lanza → no encola', async () => {
    const recalcular = vi.fn(async () => {});
    expect(await conRecalculoMetricas(fuente(false), recalcular).aplicarTransicion('o1', EVENTO)).toBe(false);
    await expect(conRecalculoMetricas(fuente(new Error('x')), recalcular).aplicarTransicion('o1', EVENTO)).rejects.toThrow('x');
    expect(recalcular).not.toHaveBeenCalled();
  });

  it('si encolar falla, la transición igual cuenta (el nocturno de 60 días recalcula) y no lanza', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = conRecalculoMetricas(fuente(true), async () => {
      throw new Error('redis caído');
    });
    expect(await g.aplicarTransicion('o1', EVENTO)).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('metrics.recompute_day no encolado'));
    error.mockRestore();
  });

  it('sin recalculador → la misma fuente', () => {
    const f = fuente(true);
    expect(conRecalculoMetricas(f, undefined)).toBe(f);
  });

  it('recalculadorMetricas lee país y fechas del pedido (después de la transición) y encola día de creación y de pago', async () => {
    const add = vi.fn(async (_nombre: string, _datos: unknown, _opciones?: unknown) => ({}));
    const cola = { add } as unknown as Queue;
    const leer = vi.fn(async () => ({
      country_code: 'CO' as const,
      created_at: new Date('2026-10-20T04:30:00Z'), // 19 oct en Bogotá
      paid_at: new Date('2026-10-20T15:00:00Z'), // 20 oct en Bogotá
    }));
    await recalculadorMetricas(cola, leer)('o1');
    expect(leer).toHaveBeenCalledWith('o1');
    expect(add.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [JOB_METRICS_RECOMPUTE_DAY, { date: '2026-10-19', country_code: 'CO' }],
      [JOB_METRICS_RECOMPUTE_DAY, { date: '2026-10-20', country_code: 'CO' }],
    ]);
  });

  it('pedido inexistente → no encola', async () => {
    const add = vi.fn(async () => ({}));
    await recalculadorMetricas({ add } as unknown as Queue, async () => null)('o1');
    expect(add).not.toHaveBeenCalled();
  });

  it('leerFechasPedidoPostgrest: una consulta por id con país, creación y pago', async () => {
    const { f, llamadas } = fetchFalso(() => ({
      status: 200,
      cuerpo: [{ country_code: 'EC', created_at: '2026-10-20T15:00:00+00:00', paid_at: null }],
    }));
    const leer = leerFechasPedidoPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 'k', claveCifrado: 'c', fetchImpl: f });
    expect(await leer('00000000-0000-4000-8000-000000000001')).toEqual({
      country_code: 'EC',
      created_at: new Date('2026-10-20T15:00:00Z'),
      paid_at: null,
    });
    expect(llamadas[0]!.url).toContain('orders?id=eq.00000000-0000-4000-8000-000000000001&select=country_code,created_at,paid_at');
  });

  it('leerFechasPedidoPostgrest: país desconocido o fecha inválida → null', async () => {
    for (const fila of [{ country_code: 'PE', created_at: '2026-10-20T15:00:00Z', paid_at: null }, { country_code: 'CO', created_at: 'x', paid_at: null }]) {
      const { f } = fetchFalso(() => ({ status: 200, cuerpo: [fila] }));
      const leer = leerFechasPedidoPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 'k', claveCifrado: 'c', fetchImpl: f });
      expect(await leer('o1')).toBeNull();
    }
  });
});
