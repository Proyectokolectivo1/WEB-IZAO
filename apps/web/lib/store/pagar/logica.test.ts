import { describe, expect, it } from 'vitest';
import { REGEX_TOKEN_PAGAR, elegirDestino, resolverPagar, urlHttps } from './logica';

const URL_OK = 'https://checkout.wompi.co/l/abc123';
const AHORA = Date.parse('2026-10-20T12:00:00Z');
const futuro = '2026-10-21T12:00:00Z';
const pasado = '2026-10-20T11:00:00Z';

describe('elegirDestino', () => {
  it('usa el checkout_url del pago pendiente y vigente', () => {
    expect(elegirDestino('https://otra.example/x', { estado: 'pending', checkoutUrl: URL_OK, venceEn: futuro }, AHORA)).toBe(URL_OK);
  });
  it('sin destino si el pago venció, ya no está pendiente o no es https', () => {
    expect(elegirDestino(URL_OK, { estado: 'pending', checkoutUrl: URL_OK, venceEn: pasado }, AHORA)).toBeNull();
    expect(elegirDestino(URL_OK, { estado: 'declined', checkoutUrl: URL_OK, venceEn: futuro }, AHORA)).toBeNull();
    expect(elegirDestino(URL_OK, { estado: 'pending', checkoutUrl: 'http://x.example', venceEn: futuro }, AHORA)).toBeNull();
  });
  it('sin pago asociado cae al target_url, solo si es https', () => {
    expect(elegirDestino(URL_OK, null, AHORA)).toBe(URL_OK);
    expect(elegirDestino('http://x.example', null, AHORA)).toBeNull();
  });
});

describe('token del link de cobro', () => {
  it('acepta 128 bits (22 base64url) y 96 bits (16)', () => {
    expect(REGEX_TOKEN_PAGAR.test('A'.repeat(22))).toBe(true);
    expect(REGEX_TOKEN_PAGAR.test('aB3_-xYz9aB3_-xY')).toBe(true);
    expect(REGEX_TOKEN_PAGAR.test('a'.repeat(64))).toBe(true);
  });
  it('rechaza cortos, largos y caracteres fuera de base64url', () => {
    for (const t of ['', 'abc', 'a'.repeat(15), 'a'.repeat(65), 'a'.repeat(21) + '/', 'a'.repeat(20) + '..', 'a'.repeat(20) + ' x', "a'; drop"]) {
      expect(REGEX_TOKEN_PAGAR.test(t)).toBe(false);
    }
  });
});

describe('urlHttps', () => {
  it('solo deja pasar https sin credenciales', () => {
    expect(urlHttps(URL_OK)).toBe(URL_OK);
    expect(urlHttps('http://checkout.wompi.co/l/x')).toBeNull();
    expect(urlHttps('javascript:alert(1)')).toBeNull();
    expect(urlHttps('//evil.example/x')).toBeNull();
    expect(urlHttps('https://user:clave@evil.example/')).toBeNull();
    expect(urlHttps('')).toBeNull();
    expect(urlHttps(null)).toBeNull();
    expect(urlHttps(42)).toBeNull();
  });
});

describe('resolverPagar', () => {
  it('redirige solo si está vigente y hay destino', () => {
    expect(resolverPagar('vigente', 'IZ-CO-1', URL_OK)).toEqual({ tipo: 'redirigir', url: URL_OK });
    expect(resolverPagar('vigente', 'IZ-CO-1', null)).toEqual({ tipo: 'vencido', numero: 'IZ-CO-1' });
  });
  it('pagado y vencido nunca redirigen, aunque haya URL', () => {
    expect(resolverPagar('pagado', 'IZ-CO-1', URL_OK)).toEqual({ tipo: 'pagado', numero: 'IZ-CO-1' });
    expect(resolverPagar('vencido', 'IZ-CO-1', URL_OK)).toEqual({ tipo: 'vencido', numero: 'IZ-CO-1' });
  });
});
