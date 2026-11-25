/**
 * Pixel ID de Meta del país (SOLO SERVIDOR). Lee la credencial activa de `meta_pixel` del país (CO y EC tienen pixeles
 * distintos: nunca se mezclan), la descifra y devuelve **solo el `pixel_id`**, que es público. El `capi_token` se descarta
 * aquí mismo: ni la función ni su caché lo conservan, así que no puede llegar al navegador.
 *
 * Sin llave de cifrado, sin credencial activa, con credencial ilegible o con un id que no son dígitos → `null` (la tienda
 * no pinta nada). La caché dura 60 s; la página que lo usa se renueva cada 5 min (`revalidate` del layout).
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import { esPixelId } from '@izao/meta-pixel';
import { clienteDb } from '@/lib/db/cliente';
import type { CodigoPais } from '../types';

export interface FilaCredencial {
  environment?: unknown;
  data_encrypted: unknown;
  iv: unknown;
  key_version: unknown;
}

/** Función pura (sin red): de las filas activas de `integration_credentials` al Pixel ID, o `null`. */
export async function pixelIdDeFilas(claveCifrado: string | undefined, pais: CodigoPais, filas: readonly FilaCredencial[]): Promise<string | null> {
  if (!claveCifrado || filas.length !== 1) return null;
  const r = filas[0]!;
  try {
    const valores = await descifrarCredenciales(
      claveCifrado,
      { provider: 'meta_pixel', country_code: pais.toUpperCase(), environment: r.environment === 'production' ? 'production' : 'sandbox' },
      { data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)), iv: byteaDesdePostgrest(String(r.iv)), key_version: Number(r.key_version) },
    );
    const id = valores.pixel_id?.trim();
    return esPixelId(id) ? id : null;
  } catch (e) {
    console.error(`[pixel] credencial de Meta Pixel ilegible (${pais}): ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}

async function leerPixelId(pais: CodigoPais): Promise<string | null> {
  const { data, error } = await clienteDb()
    .from('integration_credentials')
    .select('environment,data_encrypted,iv,key_version')
    .eq('provider', 'meta_pixel')
    .eq('country_code', pais.toUpperCase())
    .eq('is_active', true);
  if (error || !data) return null;
  return pixelIdDeFilas(process.env.APP_ENCRYPTION_KEY, pais, data as FilaCredencial[]);
}

const cacheado = unstable_cache(async (pais: CodigoPais) => (await leerPixelId(pais)) ?? '', ['pixel-meta-id'], {
  revalidate: 60,
  tags: ['pixel-meta'],
});

/** Pixel ID del país o `null`. Nunca lanza: un fallo de la base apaga el píxel, no la tienda. */
export async function pixelIdDePais(pais: CodigoPais): Promise<string | null> {
  try {
    return (await cacheado(pais)) || null;
  } catch (e) {
    console.error(`[pixel] no se pudo leer la credencial (${pais}): ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}
