import { describe, expect, it } from 'vitest';
import { maskedPreview } from '@izao/core/contracts';
import { SISTECREDITO_CREDENTIALS, parseSistecreditoCredentials } from './credentials';
import { VALORES_SISTECREDITO_PRUEBA as VALIDAS } from './mock';

describe('credenciales de Sistecrédito (§12.4, esquema inicial [VERIFICAR], D-032)', () => {
  it('esquema: CO, ambos ambientes; llave de suscripción y token de aplicación son secretos', () => {
    expect(SISTECREDITO_CREDENTIALS.provider).toBe('sistecredito');
    expect(SISTECREDITO_CREDENTIALS.countries).toEqual(['CO']);
    expect(SISTECREDITO_CREDENTIALS.environments).toEqual(['sandbox', 'production']);
    const secretos = SISTECREDITO_CREDENTIALS.fields.filter((f) => f.secret).map((f) => f.key);
    expect(secretos.sort()).toEqual(['application_key', 'application_token', 'subscription_key']);
    const claves = SISTECREDITO_CREDENTIALS.fields.map((f) => f.key);
    expect(claves).toEqual(['subscription_key', 'application_key', 'application_token', 'merchant_id', 'store_id']);
  });

  it('acepta valores completos y recorta espacios', () => {
    const r = parseSistecreditoCredentials({ ...VALIDAS, merchant_id: `  ${VALIDAS.merchant_id} ` }, 'sandbox');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credenciales.merchantId).toBe(VALIDAS.merchant_id);
      expect(r.credenciales.ambiente).toBe('sandbox');
      expect(r.credenciales.storeId).toBe(VALIDAS.store_id);
    }
  });

  it('identificador de tienda opcional → null', () => {
    const sinTienda: Record<string, string> = { ...VALIDAS };
    delete sinTienda.store_id;
    const r = parseSistecreditoCredentials(sinTienda, 'production');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.credenciales.storeId).toBeNull();
  });

  it('exige los obligatorios y los problemas no incluyen valores', () => {
    const r = parseSistecreditoCredentials({ merchant_id: 'zz-valor' }, 'production');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas.map((p) => p.key).sort()).toEqual(['application_key', 'application_token', 'subscription_key']);
      expect(JSON.stringify(r.problemas)).not.toContain('zz-valor');
    }
  });

  it('rechaza campos desconocidos, ambiente inválido y entrada vacía', () => {
    expect(parseSistecreditoCredentials({ ...VALIDAS, otro: '1' }, 'sandbox').ok).toBe(false);
    expect(parseSistecreditoCredentials(VALIDAS, 'staging' as never).ok).toBe(false);
    expect(parseSistecreditoCredentials(null, 'sandbox').ok).toBe(false);
  });

  it('vista enmascarada sin secretos completos', () => {
    const vista = maskedPreview(SISTECREDITO_CREDENTIALS, VALIDAS);
    const texto = JSON.stringify(vista);
    for (const k of ['subscription_key', 'application_key', 'application_token'] as const) {
      expect(texto).not.toContain(VALIDAS[k]);
    }
    expect(vista.merchant_id).toBe(VALIDAS.merchant_id);
  });
});
