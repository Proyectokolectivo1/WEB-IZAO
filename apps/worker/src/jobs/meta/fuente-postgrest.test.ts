import { describe, expect, it } from 'vitest';
import { byteaParaPostgrest, cifrarCredenciales } from '@izao/core/credentials';
import { crearFuenteConversionesPostgrest } from './fuente-postgrest.js';

const CLAVE = Buffer.alloc(32, 7).toString('base64');

async function filaCredencial(pais: 'CO' | 'EC', valores: Record<string, string>) {
  const c = await cifrarCredenciales(CLAVE, { provider: 'meta_pixel', country_code: pais, environment: 'production' }, valores);
  return { environment: 'production', data_encrypted: byteaParaPostgrest(c.data_encrypted), iv: byteaParaPostgrest(c.iv), key_version: c.key_version };
}

describe('fuente PostgREST de conversiones', () => {
  it('lee la credencial activa de meta_pixel del país pedido y descifra pixel_id y token', async () => {
    const urls: string[] = [];
    const fila = await filaCredencial('EC', { pixel_id: '222222222222222', capi_token: 'EAAecuador12345678' });
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify([fila]), { status: 200 });
    }) as unknown as typeof fetch;
    const f = crearFuenteConversionesPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 's', claveCifrado: CLAVE, fetchImpl });
    expect(await f.credencial('EC')).toEqual({ pixelId: '222222222222222', token: 'EAAecuador12345678' });
    expect(urls[0]).toContain('provider=eq.meta_pixel');
    expect(urls[0]).toContain('country_code=eq.EC');
    expect(urls[0]).toContain('is_active=is.true');
  });

  it('una credencial de otro país no descifra (el contexto va autenticado con el país)', async () => {
    const filaCO = await filaCredencial('CO', { pixel_id: '111111111111111', capi_token: 'EAAcolombia12345678' });
    const fetchImpl = (async () => new Response(JSON.stringify([filaCO]), { status: 200 })) as unknown as typeof fetch;
    const f = crearFuenteConversionesPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 's', claveCifrado: CLAVE, fetchImpl });
    expect(await f.credencial('EC')).toBeNull();
  });

  it('un Pixel ID que no son dígitos se descarta', async () => {
    const fila = await filaCredencial('CO', { pixel_id: 'abc', capi_token: 'EAAcolombia12345678' });
    const fetchImpl = (async () => new Response(JSON.stringify([fila]), { status: 200 })) as unknown as typeof fetch;
    const f = crearFuenteConversionesPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 's', claveCifrado: CLAVE, fetchImpl });
    expect(await f.credencial('CO')).toBeNull();
  });

  describe('consentimiento de marketing del pedido', () => {
    const ORDEN = '11111111-1111-4111-8111-111111111111';
    function fuenteCon(fila: Record<string, unknown>) {
      const urls: string[] = [];
      const fetchImpl = (async (url: string) => {
        urls.push(url);
        const cuerpo = url.includes('/orders?')
          ? [{ number: 'IZ-CO-000123', country_code: 'CO', paid_at: '2026-11-24T15:00:00Z', total_customer: 99000, ...fila }]
          : [];
        return new Response(JSON.stringify(cuerpo), { status: 200 });
      }) as unknown as typeof fetch;
      return { urls, f: crearFuenteConversionesPostgrest({ supabaseUrl: 'https://x.supabase.co', secretKey: 's', claveCifrado: CLAVE, fetchImpl }) };
    }

    it('pide marketing_consent y lo entrega cuando es true', async () => {
      const { f, urls } = fuenteCon({ marketing_consent: true });
      expect((await f.pedido(ORDEN))?.consentimientoMarketing).toBe(true);
      expect(urls[0]).toContain('marketing_consent');
    });

    it.each([
      ['false', { marketing_consent: false }],
      ['null', { marketing_consent: null }],
      ['ausente (fila sin la columna)', {}],
      ['texto "true" (no booleano)', { marketing_consent: 'true' }],
    ])('%s → false', async (_caso, fila) => {
      const { f } = fuenteCon(fila);
      expect((await f.pedido(ORDEN))?.consentimientoMarketing).toBe(false);
    });
  });
});
