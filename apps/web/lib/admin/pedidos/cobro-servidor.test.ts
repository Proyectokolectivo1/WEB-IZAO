import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditar } = vi.hoisted(() => ({ auditar: vi.fn(async (_e: unknown) => true) }));
vi.mock('@/lib/admin/auditoria', () => ({ auditarCambio: auditar }));

import { clienteFalso } from '../crud/cliente-falso';
import { linkCobroBd, reenviarCobroBd } from './cobro-servidor';

const ID = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-10-20T15:00:00Z');
const comun = { actor: 'u1', ip: null, ahora: () => AHORA };
const pedido = (extra: Record<string, unknown> = {}) => ({
  number: 'IZ-1001',
  payment_method: 'cod',
  status: 'esperando_abono',
  stock_reserved_until: '2026-10-21T15:00:00Z',
  ...extra,
});
const link = (extra: Record<string, unknown> = {}) => ({ token: 'tokenSecreto123', expires_at: '2026-10-21T15:00:00Z', ...extra });

beforeEach(() => auditar.mockClear());

describe('linkCobroBd', () => {
  it('entrega la URL del link vigente y audita quién la pidió (sin guardar el token)', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: pedido() }, 'pay_links.select': { data: [link()] } });
    const r = await linkCobroBd({ cliente, orderId: ID, origen: 'https://izaoperfumeria.com', ...comun });
    expect(r).toEqual({ ok: true, url: 'https://izaoperfumeria.com/pagar/tokenSecreto123' });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pedido.link_cobro_copiado', entidadId: ID, actor: 'u1' });
    expect(JSON.stringify(auditar.mock.calls)).not.toContain('tokenSecreto123');
  });

  it('no entrega links vencidos, de pedidos sin reserva ni de otros métodos', async () => {
    for (const [p, l] of [
      [pedido(), link({ expires_at: '2026-10-19T15:00:00Z' })],
      [pedido({ stock_reserved_until: '2026-10-19T15:00:00Z' }), link()],
      [pedido({ payment_method: 'wompi' }), link()],
      [pedido(), null],
    ] as const) {
      const { cliente } = clienteFalso({ 'orders.select': { data: p }, 'pay_links.select': { data: l ? [l] : [] } });
      const r = await linkCobroBd({ cliente, orderId: ID, origen: 'https://izaoperfumeria.com', ...comun });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain('tokenSecreto123');
    }
    expect(auditar).not.toHaveBeenCalled();
  });

  it('pedido inexistente', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { data: null } });
    expect((await linkCobroBd({ cliente, orderId: ID, origen: 'https://x.co', ...comun })).ok).toBe(false);
  });
});

describe('reenviarCobroBd', () => {
  it('encola, registra el evento con actor admin y audita', async () => {
    const { cliente, llamadas } = clienteFalso({
      'orders.select': { data: pedido() },
      'pay_links.select': { data: [link()] },
      'order_events.select': { data: [] },
      'order_events.insert': { data: null },
    });
    const encolar = vi.fn(async (_id: string) => 'encolado' as const);
    const r = await reenviarCobroBd({ cliente, orderId: ID, encolar, ...comun });
    expect(r).toMatchObject({ ok: true, resultado: 'encolado' });
    expect(encolar).toHaveBeenCalledWith(ID);
    const ev = llamadas.find((l) => l.clave === 'order_events.insert')?.args[0] as Record<string, unknown>;
    expect(ev).toMatchObject({ order_id: ID, type: 'cobro_reenvio_solicitado', actor: 'admin:u1' });
    expect(auditar.mock.calls[0]![0]).toMatchObject({ accion: 'pedido.cobro_reenviado' });
  });

  it('un segundo clic dentro del minuto no encola', async () => {
    const { cliente } = clienteFalso({
      'orders.select': { data: pedido() },
      'pay_links.select': { data: [link()] },
      'order_events.select': { data: [{ id: 'e1' }] },
    });
    const encolar = vi.fn(async () => 'encolado' as const);
    const r = await reenviarCobroBd({ cliente, orderId: ID, encolar, ...comun });
    expect(r.ok).toBe(false);
    expect(encolar).not.toHaveBeenCalled();
  });

  it('con la reserva vencida o el pedido en otro estado no encola', async () => {
    for (const p of [pedido({ stock_reserved_until: '2026-10-19T15:00:00Z' }), pedido({ status: 'abono_pagado' }), pedido({ payment_method: 'wompi' })]) {
      const { cliente } = clienteFalso({ 'orders.select': { data: p }, 'pay_links.select': { data: [] } });
      const encolar = vi.fn(async () => 'encolado' as const);
      expect((await reenviarCobroBd({ cliente, orderId: ID, encolar, ...comun })).ok).toBe(false);
      expect(encolar).not.toHaveBeenCalled();
    }
  });

  it('si la cola falla no registra evento ni auditoría y no filtra el error', async () => {
    const { cliente, llamadas } = clienteFalso({
      'orders.select': { data: pedido() },
      'pay_links.select': { data: [] },
      'order_events.select': { data: [] },
    });
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await reenviarCobroBd({
      cliente,
      orderId: ID,
      encolar: async () => {
        throw new Error('redis://usuario:clave@host');
      },
      ...comun,
    });
    espia.mockRestore();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('redis://');
    expect(llamadas.some((l) => l.clave === 'order_events.insert')).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it('devuelve el mensaje que explica un envío ya procesado', async () => {
    const { cliente } = clienteFalso({
      'orders.select': { data: pedido() },
      'pay_links.select': { data: [link()] },
      'order_events.select': { data: [] },
      'order_events.insert': { data: null },
    });
    const r = await reenviarCobroBd({ cliente, orderId: ID, encolar: async () => 'ya_procesado', ...comun });
    expect(r).toMatchObject({ ok: true, resultado: 'ya_procesado' });
    expect(r.mensaje).toContain('ya se procesó');
  });
});
