import { construirIconoPorDefecto } from '@izao/ui/tema';

/** `GET /icono-defecto.svg`: favicon neutro de respaldo (el que sube el panel en Apariencia lo reemplaza en `<head>`). */
export const dynamic = 'force-static';

export function GET() {
  return new Response(construirIconoPorDefecto(), {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
