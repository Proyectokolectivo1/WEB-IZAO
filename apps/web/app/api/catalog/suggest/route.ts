import { NextResponse, type NextRequest } from 'next/server';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { CACHE_CATALOGO, jsonCacheable } from '@/lib/store/http-cache';

/** `GET /api/catalog/suggest?country=co&q=…` — sugerencias en vivo (§7.3). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const pais = p.get('country')?.toLowerCase();
  const q = (p.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!esPais(pais) || q.length < 2) return NextResponse.json({ error: 'parametros' }, { status: 400 });
  try {
    const datos = await tienda().sugerencias(pais, q, 6);
    return jsonCacheable(req, datos, CACHE_CATALOGO.listado);
  } catch {
    return NextResponse.json({ error: 'no-disponible' }, { status: 503 });
  }
}
