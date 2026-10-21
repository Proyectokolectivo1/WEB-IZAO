import { describe, expect, it, vi } from 'vitest';
import { evaluarCobro, urlCobro } from './cobro';
import { encolarCobro, type ColaCobro } from './cola-cobro';

const AHORA = new Date('2026-10-20T15:00:00Z');
const futuro = new Date('2026-10-21T15:00:00Z');
const pasado = new Date('2026-10-19T15:00:00Z');
const cod = { payment_method: 'cod', status: 'esperando_abono', stock_reserved_until: futuro };

describe('evaluarCobro', () => {
  it('con reserva y link vigentes se puede copiar y reenviar', () => {
    const e = evaluarCobro(cod, { expires_at: futuro }, AHORA);
    expect(e).toMatchObject({ aplica: true, puedeCopiar: true, puedeReenviar: true, motivo: null });
  });

  it('sin link aún se puede reenviar (el worker lo genera) pero no copiar', () => {
    expect(evaluarCobro(cod, null, AHORA)).toMatchObject({ puedeCopiar: false, puedeReenviar: true });
  });

  it('con link vencido no se copia', () => {
    expect(evaluarCobro(cod, { expires_at: pasado }, AHORA)).toMatchObject({ puedeCopiar: false, linkVigente: false });
  });

  it('con la reserva vencida no se reenvía ni se copia, y explica por qué', () => {
    const e = evaluarCobro({ ...cod, stock_reserved_until: pasado }, { expires_at: futuro }, AHORA);
    expect(e).toMatchObject({ puedeCopiar: false, puedeReenviar: false });
    expect(e.motivo).toContain('reserva');
  });

  it('un pedido que no es contra entrega o ya no espera abono no aplica', () => {
    expect(evaluarCobro({ ...cod, payment_method: 'wompi' }, null, AHORA).aplica).toBe(false);
    expect(evaluarCobro({ ...cod, status: 'abono_pagado' }, { expires_at: futuro }, AHORA)).toMatchObject({ puedeReenviar: false, puedeCopiar: false });
  });
});

describe('urlCobro', () => {
  it('arma /pagar/{token} sin barras dobles y rechaza tokens raros', () => {
    expect(urlCobro('https://izaoperfumeria.com/', 'abcDEF123_-')).toBe('https://izaoperfumeria.com/pagar/abcDEF123_-');
    expect(() => urlCobro('https://x.co', '../../etc')).toThrow(RangeError);
    expect(() => urlCobro('https://x.co', 'corto')).toThrow(RangeError);
  });
});

describe('encolarCobro', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const T1 = new Date('2026-10-20T15:00:00.000Z');

  it('agrega cod.reenviar con el instante de la solicitud y un jobId propio', async () => {
    const add = vi.fn(async () => undefined);
    const q: ColaCobro = { add };
    expect(await encolarCobro(ID, q, () => T1)).toBe('encolado');
    expect(add).toHaveBeenCalledWith(
      'cod.reenviar',
      { order_id: ID, solicitado_en: '2026-10-20T15:00:00.000Z' },
      expect.objectContaining({ jobId: `cod.reenviar.${ID}.${T1.getTime()}`, attempts: 8 }),
    );
  });

  it('dos solicitudes en instantes distintos son jobs distintos', async () => {
    const ids: string[] = [];
    const q: ColaCobro = { add: async (_n, _d, o) => void ids.push(String(o.jobId)) };
    await encolarCobro(ID, q, () => T1);
    await encolarCobro(ID, q, () => new Date(T1.getTime() + 61_000));
    expect(new Set(ids).size).toBe(2);
  });

  it('rechaza ids que no son UUID', async () => {
    await expect(encolarCobro('no-uuid', { add: vi.fn() }, () => T1)).rejects.toThrow(RangeError);
  });
});
