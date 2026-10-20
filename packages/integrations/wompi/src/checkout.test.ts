import { describe, expect, it } from 'vitest';
import { firmaIntegridad } from './firmas';
import { WOMPI_CHECKOUT_URL, montoEnCentavos, referenciaIntento, urlWebCheckout } from './checkout';

const CRED = { llavePublica: 'pub_test_ficticia', secretoIntegridad: 'test_integrity_ficticio' };
const EXPIRA = new Date('2026-10-20T15:30:00.000Z');

describe('referencia por intento (§12.2)', () => {
  it('número del pedido + P#', () => {
    expect(referenciaIntento('IZ-CO-000123', 1)).toBe('IZ-CO-000123-P1');
    expect(referenciaIntento('IZ-CO-000123', 12)).toBe('IZ-CO-000123-P12');
  });
  it('intento inválido lanza', () => {
    expect(() => referenciaIntento('IZ-CO-000123', 0)).toThrow();
    expect(() => referenciaIntento('', 1)).toThrow();
  });
});

describe('monto en centavos', () => {
  it('COP (exponente 0) se multiplica por 100 en bigint', () => {
    expect(montoEnCentavos(249_900n, 'COP')).toBe(24_990_000n);
    expect(montoEnCentavos(9_007_199_254_740_993n, 'COP')).toBe(900_719_925_474_099_300n);
  });
  it('solo COP, monto positivo', () => {
    expect(() => montoEnCentavos(100n, 'USD')).toThrow();
    expect(() => montoEnCentavos(0n, 'COP')).toThrow();
  });
});

describe('URL del Web Checkout', () => {
  const base = {
    credenciales: CRED,
    referencia: 'IZ-CO-000123-P1',
    monto: 249_900n,
    moneda: 'COP' as const,
    expiraEn: EXPIRA,
    urlRetorno: 'https://izaoperfumeria.com/co/pedido/tok_abc',
  };

  it('https, parámetros oficiales y firma con expiración', () => {
    const r = urlWebCheckout({
      ...base,
      cliente: { email: 'ana@example.com', nombreCompleto: 'Ana Pérez', celularE164: '+573001234567' },
    });
    expect(r.url.startsWith(`${WOMPI_CHECKOUT_URL}?`)).toBe(true);
    const q = new URL(r.url).searchParams;
    expect(q.get('public-key')).toBe('pub_test_ficticia');
    expect(q.get('currency')).toBe('COP');
    expect(q.get('amount-in-cents')).toBe('24990000');
    expect(q.get('reference')).toBe('IZ-CO-000123-P1');
    expect(q.get('expiration-time')).toBe('2026-10-20T15:30:00.000Z');
    expect(q.get('redirect-url')).toBe('https://izaoperfumeria.com/co/pedido/tok_abc');
    expect(q.get('signature:integrity')).toBe(
      firmaIntegridad({
        referencia: 'IZ-CO-000123-P1',
        montoEnCentavos: 24_990_000n,
        moneda: 'COP',
        expiracion: '2026-10-20T15:30:00.000Z',
        secretoIntegridad: 'test_integrity_ficticio',
      }),
    );
    expect(q.get('customer-data:email')).toBe('ana@example.com');
    expect(q.get('customer-data:full-name')).toBe('Ana Pérez');
    expect(q.get('customer-data:phone-number')).toBe('3001234567');
    expect(q.get('customer-data:phone-number-prefix')).toBe('+57');
    expect(r.montoEnCentavos).toBe(24_990_000n);
  });

  it('nunca expone el secreto de integridad ni la llave privada en la URL', () => {
    const r = urlWebCheckout(base);
    expect(r.url).not.toContain('test_integrity_ficticio');
    expect(r.url).not.toContain('prv_');
  });

  it('sin datos del cliente no agrega customer-data; no manda documento', () => {
    const r = urlWebCheckout({ ...base, cliente: { email: null, nombreCompleto: null, celularE164: '+593991234567' } });
    expect(r.url).not.toContain('customer-data');
    expect(urlWebCheckout(base).url).not.toContain('legal-id');
  });

  it('URL de retorno debe ser https', () => {
    expect(() => urlWebCheckout({ ...base, urlRetorno: 'http://izaoperfumeria.com/x' })).toThrow();
  });

  it('fecha de expiración inválida lanza', () => {
    expect(() => urlWebCheckout({ ...base, expiraEn: new Date('x') })).toThrow();
  });
});
