/**
 * Borde de la tienda: guarda en cookies de 30 días el referido (`?ref=`), los UTM y los click IDs de la visita.
 * Solo corre en las peticiones que traen alguno de esos parámetros (el `matcher` de `middleware.ts` lo filtra con
 * `has`), así que las páginas sin parámetros no pagan el middleware. Nunca bloquea ni redirige.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  COOKIE_CLICK_IDS,
  COOKIE_REF,
  COOKIE_UTM,
  VIGENCIA_ATRIBUCION_SEG,
  serializarClickIds,
  serializarUtm,
  extraerAtribucion,
} from './captura';

export function aplicarAtribucion(request: NextRequest): NextResponse {
  const respuesta = NextResponse.next();
  const a = extraerAtribucion(request.nextUrl.searchParams);
  const base = {
    path: '/',
    maxAge: VIGENCIA_ATRIBUCION_SEG,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
  // El código lo lee el carrito en el navegador; el resto solo lo necesita el servidor.
  if (a.ref) respuesta.cookies.set(COOKIE_REF, a.ref, { ...base, httpOnly: false });
  if (Object.keys(a.utm).length > 0) respuesta.cookies.set(COOKIE_UTM, serializarUtm(a.utm), { ...base, httpOnly: true });
  if (Object.keys(a.clickIds).length > 0) {
    respuesta.cookies.set(COOKIE_CLICK_IDS, serializarClickIds(a.clickIds), { ...base, httpOnly: true });
  }
  return respuesta;
}
