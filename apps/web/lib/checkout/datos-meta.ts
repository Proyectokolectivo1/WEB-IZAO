/**
 * Datos del navegador para la API de Conversiones de Meta (§23.2): `fbp`, `fbc`, IP y user-agent del comprador.
 * Se guardan en `orders.meta_user_data` SOLO si aceptó cookies de marketing al comprar (opt-in estricto) y solo los lee el
 * worker. Cada valor se valida y se acota antes de guardarse; un valor raro se descarta, nunca bloquea la venta.
 */
import { marketingAceptadoEnCabecera } from '@/lib/store/consentimiento';

export interface DatosMetaNavegador {
  fbp?: string;
  fbc?: string;
  ip?: string;
  ua?: string;
}

// `fb.{subdominio}.{ms}.{aleatorio}` (_fbp) y `fb.{subdominio}.{ms}.{fbclid}` (_fbc).
const FBP = /^fb\.\d{1,2}\.\d{10,13}\.\d{5,20}$/;
const FBC = /^fb\.\d{1,2}\.\d{10,13}\.[A-Za-z0-9_-]{1,500}$/;
const FBCLID = /^[A-Za-z0-9_-]{1,500}$/;
const IP = /^[0-9a-fA-F:.]{3,45}$/;

function cookie(cabecera: string | null | undefined, nombre: string): string | null {
  for (const parte of (cabecera ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Primera IP de `x-forwarded-for` (el cliente; Nginx la antepone) o `x-real-ip`. */
export function ipDelCliente(h: Pick<Headers, 'get'>): string | null {
  const crudo = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || '';
  return IP.test(crudo) ? crudo : null;
}

/**
 * Sin consentimiento de marketing devuelve `null` (no se guarda nada). `fbc` sale de la cookie `_fbc` o, si falta pero el
 * anuncio dejó `fbclid`, se arma con el formato oficial `fb.1.{ms}.{fbclid}`.
 */
export function datosMetaDelNavegador(
  h: Pick<Headers, 'get'>,
  fbclid: string | null | undefined,
  ahoraMs: number,
): DatosMetaNavegador | null {
  const cabecera = h.get('cookie');
  if (!marketingAceptadoEnCabecera(cabecera)) return null;
  const fbp = cookie(cabecera, '_fbp');
  const fbcCookie = cookie(cabecera, '_fbc');
  const fbc = fbcCookie && FBC.test(fbcCookie) ? fbcCookie : fbclid && FBCLID.test(fbclid) ? `fb.1.${ahoraMs}.${fbclid}` : null;
  const ip = ipDelCliente(h);
  const ua = h.get('user-agent')?.trim().slice(0, 400) || null;
  const datos: DatosMetaNavegador = {
    ...(fbp && FBP.test(fbp) ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ...(ip ? { ip } : {}),
    ...(ua ? { ua } : {}),
  };
  return Object.keys(datos).length > 0 ? datos : null;
}
