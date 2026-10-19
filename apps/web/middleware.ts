/**
 * Protege `/admin/**` y `/api/admin/**` (§24.3, §26.1).
 *
 * Exige sesión de Supabase Auth con MFA verificado (aal2), fila activa en
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
import { NOMBRE_COOKIE_MARCA, NOMBRE_COOKIE_MARCA_MFA } from '@/lib/auth/marca-sesion';
import { auditarMfaNoAprobada } from '@/lib/auth/mfa-no-aprobada';
import { tieneCookiesDeSesion } from '@/lib/auth/supabase/cookies';
import { crearClienteMiddleware } from '@/lib/auth/supabase/middleware';

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const esApi = pathname.startsWith('/api/');
  const { supabase, obtenerRespuesta } = crearClienteMiddleware(request);

  // Sin cookies de sesión no hay nada que validar contra Supabase.
  const contexto = tieneCookiesDeSesion(request.cookies.getAll().map((c) => c.name))
    ? await cargarContexto({
        supabase,
        buscarAdmin: buscarAdminPorId,
        marca: request.cookies.get(NOMBRE_COOKIE_MARCA)?.value,
        marcaMfa: request.cookies.get(NOMBRE_COOKIE_MARCA_MFA)?.value,
        ahoraMs: Date.now(),
        secreto: secretoSesion(),
      })
    : { sesion: null, admin: null, sesionVigente: false, email: null, mfaNoAprobada: false, userId: undefined };

  // A-3: aal2 con un factor que el servidor no aprobó. Se cierra la sesión local y se audita.
  if (contexto.mfaNoAprobada) {
    if (contexto.userId) {
      await auditarMfaNoAprobada(contexto.userId, request.headers.get('x-real-ip')?.trim() ?? null);
    }
  }

  const decision: Decision = contexto.mfaNoAprobada
    ? esApi
      ? { tipo: 'rechazar', status: 403, motivo: 'mfa-no-aprobado' }
      : { tipo: 'redirigir', destino: '/admin/login?error=sin-acceso', cerrarSesion: true }
    : decidirAcceso({
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

  if (contexto.mfaNoAprobada || (decision.tipo === 'redirigir' && decision.cerrarSesion)) {
    await cerrarSesionLocal(supabase);
    for (const cookie of obtenerRespuesta().cookies.getAll()) respuesta.cookies.set(cookie);
    respuesta.cookies.delete(NOMBRE_COOKIE_MARCA);
    respuesta.cookies.delete(NOMBRE_COOKIE_MARCA_MFA);
  }

  respuesta.headers.set('Cache-Control', 'no-store');
  return respuesta;
}
