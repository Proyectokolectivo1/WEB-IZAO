import { describe, expect, it } from 'vitest';
import { datosMetaDelNavegador } from './datos-meta';

const AHORA = Date.now();
const CONSENT = `izao_consent=v1.a0.m1.t${Math.floor(AHORA / 1000)}`;
const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe('datosMetaDelNavegador', () => {
  it('sin consentimiento de marketing no guarda nada', () => {
    expect(datosMetaDelNavegador(h({ cookie: '_fbp=fb.1.1700000000000.1234567890', 'x-forwarded-for': '1.2.3.4' }), null, AHORA)).toBeNull();
  });
  it('con consentimiento toma fbp, fbc, IP del cliente y user-agent', () => {
    const d = datosMetaDelNavegador(
      h({ cookie: `${CONSENT}; _fbp=fb.1.1700000000000.1234567890; _fbc=fb.1.1700000000000.IwAR1`, 'x-forwarded-for': '181.50.1.2, 10.0.0.1', 'user-agent': 'UA/1' }),
      null,
      AHORA,
    );
    expect(d).toEqual({ fbp: 'fb.1.1700000000000.1234567890', fbc: 'fb.1.1700000000000.IwAR1', ip: '181.50.1.2', ua: 'UA/1' });
  });
  it('arma fbc desde fbclid si no hay cookie _fbc', () => {
    expect(datosMetaDelNavegador(h({ cookie: CONSENT }), 'IwAR9', AHORA)).toEqual({ fbc: `fb.1.${AHORA}.IwAR9` });
  });
  it('descarta valores con formato inválido', () => {
    expect(datosMetaDelNavegador(h({ cookie: `${CONSENT}; _fbp=<script>`, 'x-forwarded-for': 'no-es-ip!' }), 'a b', AHORA)).toBeNull();
  });
});
