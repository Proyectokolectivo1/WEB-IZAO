import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock';
import { MasterShopError } from './errors';
import { carrierRetryDelay, DEFAULT_CARRIER_RETRY_DELAYS_MS, planCarrierRetry } from './retry';

const MIN = 60_000;

describe('carrierRetryDelay (§14.5: 30 s, 2 min, 10 min, 30 min, 2 h)', () => {
  it('sigue la secuencia y se agota después del quinto reintento', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => carrierRetryDelay(n))).toEqual([
      30_000,
      2 * MIN,
      10 * MIN,
      30 * MIN,
      120 * MIN,
      null,
    ]);
    expect(DEFAULT_CARRIER_RETRY_DELAYS_MS).toHaveLength(5);
  });

  it('acepta otra secuencia desde la configuración', () => {
    expect(carrierRetryDelay(2, [1, 2, 3])).toBe(2);
    expect(carrierRetryDelay(4, [1, 2, 3])).toBeNull();
  });

  it('rechaza números de reintento inválidos', () => {
    expect(() => carrierRetryDelay(0)).toThrow(RangeError);
    expect(() => carrierRetryDelay(1.5)).toThrow(RangeError);
  });
});

describe('planCarrierRetry con reloj falso', () => {
  const server = () => new MasterShopError({ kind: 'servidor', status: 500, message: 'x' });

  it('programa cada reintento en el instante correcto', () => {
    const clock = new FakeClock(new Date('2026-10-19T15:00:00Z'));
    const at: string[] = [];
    for (let failures = 1; ; failures++) {
      const d = planCarrierRetry({ failures, error: server(), now: clock.date() });
      if (d.action === 'give_up') {
        expect(d.reason).toBe('reintentos_agotados');
        break;
      }
      at.push(d.at.toISOString());
      clock.advance(d.delayMs);
    }
    expect(at).toEqual([
      '2026-10-19T15:00:30.000Z',
      '2026-10-19T15:02:30.000Z',
      '2026-10-19T15:12:30.000Z',
      '2026-10-19T15:42:30.000Z',
      '2026-10-19T17:42:30.000Z',
    ]);
  });

  it('no reintenta errores definitivos', () => {
    for (const kind of [
      'validacion',
      'autenticacion',
      'no_encontrado',
      'estado_no_editable',
      'rechazado',
      'no_confirmado',
      'respuesta_invalida',
    ] as const) {
      const d = planCarrierRetry({
        failures: 1,
        error: new MasterShopError({ kind, message: 'x' }),
        now: new Date(0),
      });
      expect(d).toEqual({ action: 'give_up', reason: 'no_reintentable' });
    }
  });

  it('reintenta red, tiempo agotado, 5xx y edición concurrente', () => {
    for (const kind of [
      'red',
      'tiempo_agotado',
      'servidor',
      'edicion_concurrente',
      'limite',
    ] as const) {
      const d = planCarrierRetry({
        failures: 1,
        error: new MasterShopError({ kind, message: 'x' }),
        now: new Date(0),
      });
      expect(d.action).toBe('retry');
    }
  });

  it('en 429 espera lo mayor entre la política y RateLimit-Reset', () => {
    const limited = (ms: number) =>
      new MasterShopError({ kind: 'limite', status: 429, message: 'x', retryAfterMs: ms });
    expect(
      planCarrierRetry({ failures: 1, error: limited(90_000), now: new Date(0) }),
    ).toMatchObject({
      action: 'retry',
      delayMs: 90_000,
    });
    expect(
      planCarrierRetry({ failures: 1, error: limited(5_000), now: new Date(0) }),
    ).toMatchObject({
      action: 'retry',
      delayMs: 30_000,
    });
  });

  it('errores ajenos a MasterShop se reintentan', () => {
    expect(
      planCarrierRetry({ failures: 2, error: new Error('x'), now: new Date(0) }),
    ).toMatchObject({
      action: 'retry',
      delayMs: 2 * MIN,
    });
  });
});
