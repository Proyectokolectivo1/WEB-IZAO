/**
 * Verificación de Cloudflare Turnstile (§26.1) para los formularios públicos. Sin `TURNSTILE_SECRET_KEY` no se
 * verifica (desarrollo y primeros despliegues): el formulario sigue protegido por el campo trampa y el límite por IP.
 */
import 'server-only';

const URL_VERIFICACION = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileActivo(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verificarTurnstile(token: string | null, ip: string | null, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const secreto = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secreto) return true;
  if (!token || token.length > 2048) return false;
  try {
    const cuerpo = new URLSearchParams({ secret: secreto, response: token });
    if (ip) cuerpo.set('remoteip', ip);
    const r = await fetchFn(URL_VERIFICACION, { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
