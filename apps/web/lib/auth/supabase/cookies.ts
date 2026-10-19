/**
 * Cookie de sesión de Supabase propia del panel.
 *
 * La tienda usa la cookie predeterminada `sb-<ref>-auth-token`. Si el panel la
 * compartiera, al abrir /admin se leería y reescribiría (con `httpOnly`) la
 * sesión de un cliente de la tienda, y este la perdería. Con un nombre propio
 * las dos sesiones conviven sin tocarse.
 */
import { esProduccion } from '../env';

export const NOMBRE_COOKIE_SESION = 'sb-izao-admin';

export type OpcionesCookie = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | 'lax' | 'strict' | 'none';
};

/** `cookieOptions` de `createServerClient` / `createBrowserClient` en el panel. */
export function opcionesCookieSesion() {
  return { name: NOMBRE_COOKIE_SESION };
}

/** ¿Alguna de estas cookies es la sesión del panel (entera o en trozos `.0`, `.1`…)? */
export function tieneCookiesDeSesion(nombres: string[]): boolean {
  return nombres.some((n) => n === NOMBRE_COOKIE_SESION || n.startsWith(`${NOMBRE_COOKIE_SESION}.`));
}

/**
 * Todo el flujo de autenticación ocurre en el servidor, así que las cookies de
 * la sesión del panel se marcan `httpOnly`.
 */
export function endurecerCookie(opciones: OpcionesCookie | undefined): OpcionesCookie {
  return {
    ...opciones,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: esProduccion(),
  };
}
