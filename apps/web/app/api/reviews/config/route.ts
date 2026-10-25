/**
 * `GET /api/reviews/config`: clave PÚBLICA de Turnstile para el formulario de reseñas. La ficha es estática, así que la
 * clave se pide al abrir el formulario (leerla al compilar la dejaría vacía si el entorno llega después). Sin secretos.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ turnstileKey: process.env.TURNSTILE_SITE_KEY?.trim() || null }, { headers: { 'Cache-Control': 'no-store' } });
}
