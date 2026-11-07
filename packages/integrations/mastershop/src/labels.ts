/**
 * URL pública de la etiqueta (`orderLogistics.carrierTracking.shippingLabel`). La usan el worker (descarga a
 * `MEDIA_ROOT/labels/`) y la API del agente (respaldo D-051: el agente la descarga desde su PC cuando el CDN bloquea
 * la IP del VPS). Solo `https`, puerto por defecto, sin credenciales en la URL y host de la lista: nunca se pide ni se
 * entrega una URL arbitraria (SSRF).
 */

/** Hosts observados en producción para las etiquetas (CloudFront de MasterShop). */
export const HOSTS_ETIQUETA_MASTERSHOP: readonly string[] = Object.freeze(['cdn.bemaster.com']);

const MAX_LARGO_URL = 2048;

/** La URL normalizada si es segura; `null` si no. */
export function urlEtiquetaSegura(
  valor: unknown,
  hosts: readonly string[] = HOSTS_ETIQUETA_MASTERSHOP,
): string | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > MAX_LARGO_URL) return null;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '') return null;
  if (u.port !== '' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (!hosts.some((h) => h.toLowerCase() === host)) return null;
  u.hash = '';
  return u.toString();
}
