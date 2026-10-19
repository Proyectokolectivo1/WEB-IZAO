import { describe, expect, it } from 'vitest';
import { parseRateLimit, RateLimitGate, resetDelayMs } from './rate-limit';

const h = (o: Record<string, string>) => new Headers(o);

describe('parseRateLimit', () => {
  it('lee las tres cabeceras sin importar mayúsculas', () => {
    expect(
      parseRateLimit(
        h({ 'RateLimit-Limit': '100', 'ratelimit-remaining': '7', 'RATELIMIT-RESET': '42' }),
      ),
    ).toEqual({ limit: 100, remaining: 7, resetSeconds: 42 });
  });

  it('null si no vienen; ignora valores no numéricos', () => {
    expect(parseRateLimit(h({}))).toBeNull();
    expect(parseRateLimit(h({ 'RateLimit-Reset': 'pronto', 'RateLimit-Limit': '5' }))).toEqual({
      limit: 5,
      remaining: null,
      resetSeconds: null,
    });
  });

  it('resetDelayMs usa Reset o el respaldo', () => {
    expect(resetDelayMs({ limit: null, remaining: 0, resetSeconds: 12 }, 60_000)).toBe(12_000);
    expect(resetDelayMs(null, 60_000)).toBe(60_000);
  });
});

describe('RateLimitGate', () => {
  it('bloquea hasta el reinicio cuando Remaining llega a 0', () => {
    const gate = new RateLimitGate();
    gate.observe({ limit: 10, remaining: 3, resetSeconds: 30 }, 1_000);
    expect(gate.waitMs(1_000)).toBe(0);
    gate.observe({ limit: 10, remaining: 0, resetSeconds: 30 }, 1_000);
    expect(gate.waitMs(1_000)).toBe(30_000);
    expect(gate.waitMs(21_000)).toBe(10_000);
    expect(gate.waitMs(31_000)).toBe(0);
  });

  it('blockUntil nunca acorta un bloqueo mayor', () => {
    const gate = new RateLimitGate();
    gate.blockUntil(50_000);
    gate.blockUntil(10_000);
    expect(gate.waitMs(0)).toBe(50_000);
  });
});
