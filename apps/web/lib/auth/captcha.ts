/**
 * CAPTCHA del login de /admin (Supabase Auth con Cloudflare Turnstile).
 *
 * El CAPTCHA se activa o apaga EN SUPABASE (Authentication > Bot and Abuse Protection). El formulario siempre envía
 * el token si hay clave de sitio; con el CAPTCHA apagado Supabase lo ignora y con él encendido lo exige. La clave de
 * sitio es pública (`TURNSTILE_SITE_KEY`, la misma de los formularios de la tienda); la clave secreta vive solo en Supabase.
 */

/** Los tokens de Turnstile miden como máximo 2 048 caracteres. */
export const MAX_LARGO_TOKEN_CAPTCHA = 2048;

/** Clave de sitio pública del entorno; `null` si no hay (el login funciona sin widget). */
export function claveSitioCaptcha(valor: string | undefined): string | null {
  const limpia = valor?.trim();
  return limpia ? limpia : null;
}

/** Opciones de `signInWithPassword`: solo lleva `captchaToken` si el navegador entregó uno. */
export function opcionesCaptcha(token: string | null | undefined): { captchaToken?: string } {
  const limpio = token?.trim();
  return limpio ? { captchaToken: limpio } : {};
}

/** ¿El rechazo de Supabase Auth se debe al CAPTCHA (token ausente, vencido o inválido)? */
export function esErrorCaptcha(error: { code?: string | undefined; message?: string | undefined } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'captcha_failed') return true;
  return /captcha/i.test(error.message ?? '');
}
