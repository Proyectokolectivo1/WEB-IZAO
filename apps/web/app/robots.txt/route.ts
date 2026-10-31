import { PAISES } from '@/lib/store/pais';
import { SITIO } from '@/lib/store/seo';
import { textoRobots } from '@/lib/store/sitemap';

/** `GET /robots.txt`: permite el sitio público, cierra panel, API y pantallas privadas, y apunta a los sitemaps. */
export const revalidate = 3600;

export function GET() {
  return new Response(textoRobots(SITIO, PAISES), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
