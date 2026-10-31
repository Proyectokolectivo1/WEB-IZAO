import { PAISES } from '@/lib/store/pais';
import { SITIO } from '@/lib/store/seo';
import { xmlIndice } from '@/lib/store/sitemap';

/** `GET /sitemap.xml`: índice con el sitemap de cada país (§5.2). */
export const revalidate = 3600;

export function GET() {
  return new Response(xmlIndice(SITIO, PAISES.map((p) => `/${p}/sitemap.xml`)), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
