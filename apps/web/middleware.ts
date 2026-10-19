/**
 * Protege `/admin/**` y `/api/admin/**` (§24.3, §26.1).
 *
 * Exige sesión de Supabase Auth con MFA verificado (aal2), fila activa en
 * `admin_users`, marca de sesión de 12 h vigente y un rol con acceso al módulo.
 * No toca `/api/health` ni ninguna ruta pública: el `matcher` solo cubre el panel.
 *
 * La decisión vive en `lib/auth/decision.ts` (función pura con pruebas).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { cargarContexto } from '@/lib/auth/contexto';
import { buscarAdminPorId } from '@/lib/auth/admin-users';
import { decidirAcceso } from '@/lib/auth/decision';
import { secretoSesion } from '@/lib/auth/env';
import { NOMBRE_COOKIE_MARCA } from '@/lib/auth/marca-sesion';
import { crearClienteMiddleware } from '@/lib/auth/supabase/middleware';

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

/** Prefijo de las cookies de sesión de Supabase (`sb-<ref>-auth-token…`). */
function tieneCookiesDeSesion(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const esApi = pathname.startsWith('/api/');
  const { supabase, obtenerRespuesta } = crearClienteMiddleware(request);

  // Sin cookies de sesión no hay nada que validar contra Supabase.
  const contexto = tieneCookiesDeSesion(request)
    ? await cargarContexto({
        supabase,
        buscarAdmin: buscarAdminPorId,
        marca: request.cookies.get(NOMBRE_COOKIE_MARCA)?.value,
        ahoraMs: Date.now(),
        secreto: secretoSesion(),
      })
    : { sesion: null, admin: null, sesionVigente: false, email: null };

  const decision = decidirAcceso({
    pathname: pathname + search,
    esApi,
    sesion: contexto.sesion,
    admin: contexto.admin,
    sesionVigente: contexto.sesionVigente,
  });

  if (decision.tipo === 'permitir') return obtenerRespuesta();

  const respuesta =
    decision.tipo === 'rechazar'
      ? NextResponse.json({ error: decision.motivo }, { status: decision.status })
      : // 303: tras un POST (Server Action) el navegador sigue con GET.
        NextResponse.redirect(new URL(decision.destino, request.url), 303);

  // Conserva las cookies renovadas por Supabase durante esta petición.
  for (const cookie of obtenerRespuesta().cookies.getAll()) respuesta.cookies.set(cookie);

  if (decision.tipo === 'redirigir' && decision.cerrarSesion) {
    await supabase.auth.signOut();
    for (const cookie of obtenerRespuesta().cookies.getAll()) respuesta.cookies.set(cookie);
    respuesta.cookies.delete(NOMBRE_COOKIE_MARCA);
  }

  respuesta.headers.set('Cache-Control', 'no-store');
  return respuesta;
}
