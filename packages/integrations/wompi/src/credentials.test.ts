import { describe, expect, it } from 'vitest';
import { maskedPreview } from '@izao/core/contracts';
import { WOMPI_CREDENTIALS, parseWompiCredentials } from './credentials';

// Valores ficticios con el prefijo de cada ambiente; no son llaves reales.
const SANDBOX = {
  public_key: 'pub_test_ficticia0001',
  private_key: 'prv_test_ficticia0002',
  events_secret: 'test_events_ficticio0003',
  integrity_secret: 'test_integrity_ficticio0004',
};

describe('credenciales de Wompi (§12.2)', () => {
  it('esquema: pública visible; privada y secretos marcados como secretos', () => {
    const secretos = WOMPI_CREDENTIALS.fields.filter((f) => f.secret).map((f) => f.key);
    expect(secretos.sort()).toEqual(['events_secret', 'integrity_secret', 'private_key']);
    expect(WOMPI_CREDENTIALS.countries).toEqual(['CO']);
    expect(WOMPI_CREDENTIALS.environments).toEqual(['sandbox', 'production']);
  });

  it('acepta llaves de sandbox en sandbox', () => {
    const r = parseWompiCredentials(SANDBOX, 'sandbox');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.credenciales.llavePublica).toBe('pub_test_ficticia0001');
  });

  it('rechaza mezclar ambientes (llave de producción en sandbox o al revés)', () => {
    const r = parseWompiCredentials(SANDBOX, 'production');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.key).sort()).toEqual(
      ['events_secret', 'integrity_secret', 'private_key', 'public_key'],
    );
    const mixta = parseWompiCredentials({ ...SANDBOX, private_key: 'prv_prod_ficticia' }, 'sandbox');
    expect(mixta.ok).toBe(false);
  });

  it('faltantes y campos desconocidos', () => {
    const r = parseWompiCredentials({ public_key: 'pub_test_x', otro: 'y' }, 'sandbox');
    expect(r.ok).toBe(false);
    expect(parseWompiCredentials(null, 'sandbox').ok).toBe(false);
  });

  it('los mensajes de error no contienen valores secretos', () => {
    const r = parseWompiCredentials({ ...SANDBOX, private_key: 'prv_prod_SECRETO123' }, 'sandbox');
    expect(JSON.stringify(r)).not.toContain('SECRETO123');
  });

  it('vista enmascarada del panel', () => {
    const m = maskedPreview(WOMPI_CREDENTIALS, SANDBOX);
    expect(m.public_key).toBe('pub_test_ficticia0001');
    expect(m.private_key).toBe('prv_test_****0002');
  });
});
