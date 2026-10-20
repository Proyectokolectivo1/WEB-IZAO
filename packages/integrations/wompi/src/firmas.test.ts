import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checksumEvento, firmaIntegridad, iguales } from './firmas';

// Vectores publicados en docs.wompi.co (secretos de ejemplo de la documentación, no reales).
describe('firma de integridad (Web Checkout)', () => {
  it('vector oficial sin expiración', () => {
    expect(
      firmaIntegridad({
        referencia: 'sk8-438k4-xmxm392-sn2m',
        montoEnCentavos: 2490000n,
        moneda: 'COP',
        secretoIntegridad: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
      }),
    ).toBe('37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5');
  });

  it('con expiración la fecha va entre moneda y secreto', () => {
    const conFecha = firmaIntegridad({
      referencia: 'sk8-438k4-xmxm392-sn2m',
      montoEnCentavos: 2490000n,
      moneda: 'COP',
      expiracion: '2023-06-09T20:28:50.000Z',
      secretoIntegridad: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
    });
    // La documentación publica la cadena concatenada (sin el hash): se compara contra ella.
    const cadena =
      'sk8-438k4-xmxm392-sn2m2490000COP2023-06-09T20:28:50.000Zprod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6';
    expect(conFecha).toBe(createHash('sha256').update(cadena, 'utf8').digest('hex'));
  });

  it('rechaza montos no enteros positivos o datos vacíos', () => {
    const base = { referencia: 'R', montoEnCentavos: 100n, moneda: 'COP', secretoIntegridad: 's' } as const;
    expect(() => firmaIntegridad({ ...base, montoEnCentavos: 0n })).toThrow();
    expect(() => firmaIntegridad({ ...base, referencia: '' })).toThrow();
    expect(() => firmaIntegridad({ ...base, secretoIntegridad: '' })).toThrow();
  });
});

describe('checksum de eventos', () => {
  it('ejemplo oficial: concatena valores + timestamp + secreto y aplica SHA256', () => {
    const c = checksumEvento(
      ['1234-1610641025-49201', 'APPROVED', '4490000'],
      1530291411,
      'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z',
    );
    // Cadena del paso 3 de la documentación, tal cual.
    const cadena = '1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';
    expect(c).toBe(createHash('sha256').update(cadena, 'utf8').digest('hex'));
    // El hash publicado en el paso 4 (3476DDA5…) es ilustrativo: no es el SHA256 de esa cadena (D-024).
    expect(c).toBe('5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe');
  });
});

describe('comparación en tiempo constante', () => {
  it('ignora mayúsculas en hex y rechaza largos distintos', () => {
    expect(iguales('abcdef', 'ABCDEF')).toBe(true);
    expect(iguales('abcdef', 'abcdee')).toBe(false);
    expect(iguales('abc', 'abcd')).toBe(false);
  });
});
