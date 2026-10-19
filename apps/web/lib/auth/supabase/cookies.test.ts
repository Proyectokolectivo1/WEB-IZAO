import { createServerClient } from '@supabase/ssr';
import { describe, expect, it } from 'vitest';
import { NOMBRE_COOKIE_SESION, opcionesCookieSesion, tieneCookiesDeSesion } from './cookies';

function jwtDePrueba(): string {
  const b64 = (o: object | string) =>
    Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', aud: 'authenticated', role: 'authenticated', exp })}.${b64('firma-de-prueba-123456789012345678901234')}`;
}

describe('cookie de sesión propia del panel (no comparte la de la tienda)', () => {
  it('el nombre no es el predeterminado sb-<ref>-auth-token de la tienda', () => {
    expect(NOMBRE_COOKIE_SESION).toBe('sb-izao-admin');
    expect(NOMBRE_COOKIE_SESION).not.toMatch(/^sb-.+-auth-token/);
  });

  it('una cookie de sesión de la tienda no cuenta como sesión del panel', () => {
    expect(tieneCookiesDeSesion(['sb-wyxjmlgrcjclelbrluvd-auth-token'])).toBe(false);
    expect(tieneCookiesDeSesion(['sb-wyxjmlgrcjclelbrluvd-auth-token.0', 'otra'])).toBe(false);
  });

  it('reconoce la cookie del panel, entera o en trozos', () => {
    expect(tieneCookiesDeSesion(['sb-izao-admin'])).toBe(true);
    expect(tieneCookiesDeSesion(['x', 'sb-izao-admin.0', 'sb-izao-admin.1'])).toBe(true);
    expect(tieneCookiesDeSesion(['sb-izao-admin-otra'])).toBe(false);
  });

  it('un cliente de Supabase configurado con las opciones guarda la sesión con ese nombre', async () => {
    const guardadas: { name: string }[] = [];
    const fetchSimulado: typeof fetch = async () =>
      new Response(
        JSON.stringify({ id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'a@b.co' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const supabase = createServerClient('https://ejemplo.supabase.co', 'llave-publicable-falsa', {
      cookieOptions: opcionesCookieSesion(),
      global: { fetch: fetchSimulado },
      cookies: {
        getAll: () => [],
        setAll: (lista) => {
          for (const c of lista) guardadas.push({ name: c.name });
        },
      },
    });
    await supabase.auth.setSession({
      access_token: jwtDePrueba(),
      refresh_token: 'refresco-falso',
    });
    expect(guardadas.length).toBeGreaterThan(0);
    for (const c of guardadas) expect(c.name.startsWith(NOMBRE_COOKIE_SESION)).toBe(true);
  });
});
