import { describe, expect, it } from 'vitest';
import { maskedPreview } from '@izao/core/contracts';
import { ADDI_CREDENTIALS, ADDI_ENDPOINTS, parseAddiCredentials } from './credentials';

// Valores ficticios; no son credenciales reales.
const VALIDAS = {
  client_id: 'aWQtZmljdGljaW8tZGUtcHJ1ZWJh',
  client_secret: 'c2VjcmV0by1maWN0aWNpby1kZS1wcnVlYmE',
  callback_username: 'izao-callback',
  callback_password: 'clave-ficticia-de-callback-0001',
};

describe('credenciales de Addi (§12.3, D-031)', () => {
  it('esquema: secreto del cliente y clave del callback son secretos; CO; ambos ambientes', () => {
    const secretos = ADDI_CREDENTIALS.fields.filter((f) => f.secret).map((f) => f.key);
    expect(secretos.sort()).toEqual(['callback_password', 'client_secret']);
    expect(ADDI_CREDENTIALS.provider).toBe('addi');
    expect(ADDI_CREDENTIALS.countries).toEqual(['CO']);
    expect(ADDI_CREDENTIALS.environments).toEqual(['sandbox', 'production']);
    const opcionales = ADDI_CREDENTIALS.fields.filter((f) => !f.required).map((f) => f.key);
    expect(opcionales).toEqual(['ally_slug']);
  });

  it('acepta credenciales completas y recorta espacios', () => {
    const r = parseAddiCredentials({ ...VALIDAS, client_id: `  ${VALIDAS.client_id} ` }, 'sandbox');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credenciales.clientId).toBe(VALIDAS.client_id);
      expect(r.credenciales.ambiente).toBe('sandbox');
      expect(r.credenciales.allySlug).toBeNull();
    }
  });

  it('exige los obligatorios y no devuelve valores en los problemas', () => {
    const r = parseAddiCredentials({ client_id: 'x' }, 'production');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas.map((p) => p.key).sort()).toEqual(['callback_password', 'callback_username', 'client_secret']);
      expect(JSON.stringify(r.problemas)).not.toContain('x"');
    }
  });

  it('rechaza claves de callback débiles (< 16) o usuarios con ":" (Basic auth)', () => {
    const r = parseAddiCredentials({ ...VALIDAS, callback_password: 'corta', callback_username: 'a:b' }, 'sandbox');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.key).sort()).toEqual(['callback_password', 'callback_username']);
  });

  it('rechaza campos desconocidos y ambiente inválido', () => {
    expect(parseAddiCredentials({ ...VALIDAS, otro: '1' }, 'sandbox').ok).toBe(false);
    expect(parseAddiCredentials(VALIDAS, 'staging' as never).ok).toBe(false);
    expect(parseAddiCredentials(null, 'sandbox').ok).toBe(false);
  });

  it('vista enmascarada sin secretos completos', () => {
    const vista = maskedPreview(ADDI_CREDENTIALS, VALIDAS);
    expect(vista.client_secret).toBe('****ZWJh');
    expect(JSON.stringify(vista)).not.toContain(VALIDAS.callback_password);
  });

  it('servidores y audiencia oficiales por ambiente (api-docs-sandbox.addi.com)', () => {
    expect(ADDI_ENDPOINTS.sandbox).toEqual({
      auth: 'https://auth.addi-staging.com/oauth/token',
      audience: 'https://api.staging.addi.com',
      api: 'https://api.addi-staging.com',
    });
    expect(ADDI_ENDPOINTS.production).toEqual({
      auth: 'https://auth.addi.com/oauth/token',
      audience: 'https://api.addi.com',
      api: 'https://api.addi.com',
    });
  });
});
