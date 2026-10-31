import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { SITIO } from '@/lib/store/seo';
import { xmlUrlset, type EntradaSitemap } from '@/lib/store/sitemap';
import type { CursorRpc } from '@/lib/store/types';

/**
 * `GET /{pais}/sitemap.xml` (§5.2): inicio, listados, taxonomías, productos visibles en ese país, páginas publicadas y
 * garantías. Los productos salen del catálogo del país (nunca de otro país ni los no visibles). Caché de 1 h.
 */
export const revalidate = 3600;

const LOTE = 50;
const MAX_LOTES = 400; // tope de seguridad: 20.000 productos por país

export async function GET(_req: Request, { params }: { params: Promise<{ country: string }> }) {
  const { country: pais } = await params;
  if (!esPais(pais)) return new Response('No encontrado', { status: 404 });
  const repo = tienda();

  const [filtros, paginas] = await Promise.all([repo.opcionesFiltros(pais).catch(() => null), repo.paginas(pais).catch(() => [])]);
  const entradas: EntradaSitemap[] = [{ ruta: `/${pais}` }, { ruta: `/${pais}/catalogo` }, { ruta: `/${pais}/garantias` }];
  for (const m of filtros?.marcas ?? []) entradas.push({ ruta: `/${pais}/marca/${m.slug}` });
  for (const f of filtros?.familias ?? []) entradas.push({ ruta: `/${pais}/familia/${f.slug}` });
  for (const c of filtros?.categorias ?? []) entradas.push({ ruta: `/${pais}/categoria/${c.slug}` });
  for (const p of paginas) entradas.push({ ruta: `/${pais}/pagina/${p.slug}` });

  let cursor: CursorRpc | null = null;
  for (let i = 0; i < MAX_LOTES; i++) {
    const r = await repo.catalogo(pais, { filtros: {}, orden: 'newest', cursor, limite: LOTE });
    for (const it of r.items) entradas.push({ ruta: `/${pais}/perfume/${it.slug}`, modificado: it.published_at });
    if (!r.next_cursor || r.items.length === 0) break;
    cursor = r.next_cursor;
  }

  return new Response(xmlUrlset(SITIO, entradas), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
