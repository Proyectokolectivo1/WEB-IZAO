/**
 * Lógica pura de `/{pais}/pagar/{token}` (§12.2, §13.1): validación del token y decisión de a dónde llevar al cliente.
 * Sin red ni base: se prueba aparte. El acceso a datos vive en `datos.ts`.
 */

/**
 * Token del link de cobro (`pay_links.token`, base64url). Con 128 bits mide 22 caracteres; se aceptan desde 16 (96 bits,
 * lo que genera hoy el worker) hasta 64 que admite la base. Un formato inválido se resuelve como 404 sin tocar la base.
 */
export const REGEX_TOKEN_PAGAR = /^[A-Za-z0-9_-]{16,64}$/;

export type EstadoEnlace = 'vigente' | 'pagado' | 'vencido';

export interface PagoEnlace {
  estado: string;
  checkoutUrl: string | null;
  venceEn: string | null;
}

/** Devuelve la URL solo si es `https:` sin credenciales incrustadas; si no, `null` (nunca se redirige a otro esquema). */
export function urlHttps(valor: unknown): string | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 2048) return null;
  try {
    const u = new URL(valor);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const aMs = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Destino de pago de un link: si tiene su pago en `payments`, su `checkout_url` (https, sin vencer y en `created`/`pending`);
 * si ese pago ya no sirve, no hay destino. Sin pago asociado se usa el `target_url` del link, también solo si es https.
 * Lo usa la confirmación del pedido para saber si ofrece «Pagar abono»; la visita a /pagar la decide `pay_link_click`.
 */
export function elegirDestino(targetUrl: unknown, pago: PagoEnlace | null, ahoraMs: number): string | null {
  if (!pago) return urlHttps(targetUrl);
  if (pago.estado !== 'created' && pago.estado !== 'pending') return null;
  const vence = aMs(pago.venceEn);
  if (vence !== null && vence <= ahoraMs) return null;
  return urlHttps(pago.checkoutUrl);
}

export type ResultadoPagar =
  | { tipo: 'no_existe' }
  | { tipo: 'redirigir'; url: string }
  | { tipo: 'pagado'; numero: string }
  | { tipo: 'vencido'; numero: string };

/** Une el estado del link con el destino: un link «vigente» sin destino https válido se trata como vencido. */
export function resolverPagar(estado: EstadoEnlace, numero: string, destino: string | null): ResultadoPagar {
  if (estado === 'pagado') return { tipo: 'pagado', numero };
  if (estado === 'vigente' && destino) return { tipo: 'redirigir', url: destino };
  return { tipo: 'vencido', numero };
}
