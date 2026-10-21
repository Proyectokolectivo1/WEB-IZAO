import { describe, expect, it, vi } from 'vitest';
import { evaluarCobro, urlCobro } from './cobro';
import { encolarCobro, type ColaCobro, type JobCobro } from './cola-cobro';

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
  const cola = (job: Partial<Record<keyof JobCobro, boolean>> | null) => {
    const retry = vi.fn(async () => undefined);
    const add = vi.fn(async () => undefined);
    const q: ColaCobro = {
      getJob: async () =>
        job
          ? { isFailed: async () => job.isFailed ?? false, isCompleted: async () => job.isCompleted ?? false, retry }
          : undefined,
      add,
    };
    return { q, retry, add };
  };

  it('sin job previo agrega cod.iniciar con la misma clave de idempotencia del checkout', async () => {
    const { q, add } = cola(null);
    expect(await encolarCobro(ID, q)).toBe('encolado');
    expect(add).toHaveBeenCalledWith('cod.iniciar', { order_id: ID }, expect.objectContaining({ jobId: `cod.iniciar.${ID}`, attempts: 8 }));
  });

  it('si el job falló lo reintenta; no agrega otro', async () => {
    const { q, retry, add } = cola({ isFailed: true });
    expect(await encolarCobro(ID, q)).toBe('reintentado');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it('si está en curso o ya terminó no duplica', async () => {
    const a = cola({});
    expect(await encolarCobro(ID, a.q)).toBe('en_curso');
    const b = cola({ isCompleted: true });
    expect(await encolarCobro(ID, b.q)).toBe('ya_procesado');
    expect(a.add).not.toHaveBeenCalled();
    expect(b.add).not.toHaveBeenCalled();
  });

  it('rechaza ids que no son UUID', async () => {
    await expect(encolarCobro('no-uuid', cola(null).q)).rejects.toThrow(RangeError);
  });
});
