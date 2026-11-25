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
});
