/**
 * ¿Se pueden usar los datos de ejemplo (sin base)? En producción NUNCA, salvo en un build de PRUEBAS que lo pida con
 * `STORE_DATOS_PERMITIR_EJEMPLO=1` (y, además, `STORE_DATOS=ejemplo`): así las pruebas e2e y Lighthouse miden el build de
 * producción real sin llaves y sin parchar copias del código. Un despliegue de verdad no define esa variable.
 *
 * Doble seguro: aunque la variable se colara en un despliegue real, el modo ejemplo se niega si `SITE_URL` apunta al
 * dominio oficial de la tienda (izaoperfumeria.com): ese entorno es producción y debe usar Supabase.
 */
const DOMINIOS_OFICIALES = ['izaoperfumeria.com'];

export function esSitioOficial(siteUrl: string | undefined = process.env.SITE_URL): boolean {
  if (!siteUrl) return false;
  try {
    const host = new URL(siteUrl).hostname.toLowerCase();
    return DOMINIOS_OFICIALES.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function ejemploPermitido(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.STORE_DATOS_PERMITIR_EJEMPLO === '1' && !esSitioOficial();
}
