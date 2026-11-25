import { describe, expect, it, vi } from 'vitest';
import { byteaParaPostgrest, cifrarCredenciales } from '@izao/core/credentials';
import { pixelIdDeEjemplo, pixelIdDeFilas } from './pixel-id';

const CLAVE = Buffer.alloc(32, 9).toString('base64');
const TOKEN = 'EAAsecretoDelServidor1234567890';

async function fila(pais: 'CO' | 'EC', valores: Record<string, string>) {
  const c = await cifrarCredenciales(CLAVE, { provider: 'meta_pixel', country_code: pais, environment: 'production' }, valores);
  return { environment: 'production', data_encrypted: byteaParaPostgrest(c.data_encrypted), iv: byteaParaPostgrest(c.iv), key_version: c.key_version };
}

describe('Pixel ID del país', () => {
  it('devuelve solo el pixel_id (nunca el token)', async () => {
    const f = await fila('CO', { pixel_id: '111111111111111', capi_token: TOKEN });
    const r = await pixelIdDeFilas(CLAVE, 'co', [f]);
    expect(r).toBe('111111111111111');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it('cada país usa su propia credencial: la de Colombia no sirve para Ecuador', async () => {
    const co = await fila('CO', { pixel_id: '111111111111111', capi_token: TOKEN });
    const ec = await fila('EC', { pixel_id: '222222222222222', capi_token: TOKEN });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await pixelIdDeFilas(CLAVE, 'ec', [ec])).toBe('222222222222222');
    expect(await pixelIdDeFilas(CLAVE, 'ec', [co])).toBeNull();
    expect(await pixelIdDeFilas(CLAVE, 'co', [ec])).toBeNull();
    log.mockRestore();
  });

  it('sin credencial activa, con dos activas o sin llave de cifrado: null', async () => {
    const f = await fila('CO', { pixel_id: '111111111111111', capi_token: TOKEN });
    expect(await pixelIdDeFilas(CLAVE, 'co', [])).toBeNull();
    expect(await pixelIdDeFilas(CLAVE, 'co', [f, f])).toBeNull();
    expect(await pixelIdDeFilas(undefined, 'co', [f])).toBeNull();
  });

  it('un id que no son dígitos se descarta', async () => {
    const f = await fila('CO', { pixel_id: '1");alert(1);//', capi_token: TOKEN });
    expect(await pixelIdDeFilas(CLAVE, 'co', [f])).toBeNull();
  });

  it('una credencial ilegible no rompe la tienda y no se imprime el token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await pixelIdDeFilas(CLAVE, 'co', [{ environment: 'production', data_encrypted: '\\x00', iv: '\\x00', key_version: 1 }])).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });
});

describe('Pixel ID de ejemplo (solo pruebas locales)', () => {
  const env = { STORE_DATOS: 'ejemplo', EJEMPLO_PIXEL: '{"co":"111111111111111","ec":"222222222222222"}' };

  it('cada país lee el suyo', () => {
    expect(pixelIdDeEjemplo('co', env, true)).toBe('111111111111111');
    expect(pixelIdDeEjemplo('ec', env, true)).toBe('222222222222222');
  });

  it('sin STORE_DATOS=ejemplo no tiene efecto, y valores inválidos se ignoran', () => {
    expect(pixelIdDeEjemplo('co', { ...env, STORE_DATOS: 'supabase' }, true)).toBeNull();
    expect(pixelIdDeEjemplo('co', { STORE_DATOS: 'ejemplo', EJEMPLO_PIXEL: '{"co":"abc"}' }, true)).toBeNull();
    expect(pixelIdDeEjemplo('co', { STORE_DATOS: 'ejemplo', EJEMPLO_PIXEL: 'no es json' }, true)).toBeNull();
    expect(pixelIdDeEjemplo('co', { STORE_DATOS: 'ejemplo' }, true)).toBeNull();
    // Producción real (sin permiso de ejemplo): nunca.
    expect(pixelIdDeEjemplo('co', env, false)).toBeNull();
  });
});
