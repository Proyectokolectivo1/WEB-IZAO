/**
 * Protege `/admin/**` y `/api/admin/**` (§24.3, §26.1).
 *
 * Exige sesión de Supabase Auth (correo y contraseña; sin segundo factor, D-053), fila activa en
 * `admin_users`, marca de sesión de 12 h vigente y un rol con acceso al módulo.
 * No toca `/api/health` ni ninguna ruta pública: el `matcher` solo cubre el panel.
 *
 * La decisión vive en `lib/auth/decision.ts` (función pura con pruebas).
 */
import { cerrarSesionLocal } from '@/lib/auth/cerrar-sesion';
import { NextResponse, type NextRequest } from 'next/server';
import { cargarContexto } from '@/lib/auth/contexto';
import { buscarAdminPorId } from '@/lib/auth/admin-users';
import { decidirAcceso, type Decision } from '@/lib/auth/decision';
import { secretoSesion } from '@/lib/auth/env';
import { NOMBRE_COOKIE_MARCA } from '@/lib/auth/marca-sesion';
import { tieneCookiesDeSesion } from '@/lib/auth/supabase/cookies';
import { crearClienteMiddleware } from '@/lib/auth/supabase/middleware';
import { aplicarAtribucion } from '@/lib/store/atribucion/middleware';

// La atribución de la tienda (izao-tienda) solo corre con parámetros de campaña; las rutas internas quedan fuera.
// Las fuentes van como literales (Next analiza el `matcher` de forma estática).
export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    { source: '/((?!admin|api|_next|.*\\..*).*)', has: [{ type: 'query', key: 'ref' }] },
    { source: '/((?!admin|api|_next|.*\\..*).*)', has: [{ type: 'query', key: 'utm_source' }] },
    { source: '/((?!admin|api|_next|.*\\..*).*)', has: [{ type: 'query', key: 'fbclid' }] },
    { source: '/((?!admin|api|_next|.*\\..*).*)', has: [{ type: 'query', key: 'gclid' }] },
    { source: '/((?!admin|api|_next|.*\\..*).*)', has: [{ type: 'query', key: 'ttclid' }] },
  ],
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) return aplicarAtribucion(request);
  const esApi = pathname.startsWith('/api/');
  const { supabase, obtenerRespuesta } = crearClienteMiddleware(request);

  // Sin cookies de sesión no hay nada que validar contra Supabase.
  const contexto = tieneCookiesDeSesion(request.cookies.getAll().map((c) => c.name))
    ? await cargarContexto({
        supabase,
        buscarAdmin: buscarAdminPorId,
        marca: request.cookies.get(NOMBRE_COOKIE_MARCA)?.value,
        ahoraMs: Date.now(),
        secreto: secretoSesion(),
      })
    : { sesion: null, admin: null, sesionVigente: false, email: null, userId: undefined };

  const decision: Decision = decidirAcceso({
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
    await cerrarSesionLocal(supabase);
    for (const cookie of obtenerRespuesta().cookies.getAll()) respuesta.cookies.set(cookie);
    respuesta.cookies.delete(NOMBRE_COOKIE_MARCA);
    // Cookie de la MFA retirada (D-053): se limpia si quedó de una sesión anterior.
    respuesta.cookies.delete('izao_admin_mfa');
  }

  respuesta.headers.set('Cache-Control', 'no-store');
  return respuesta;
}
