import { NextResponse, type NextRequest } from 'next/server';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';
import { CACHE_CATALOGO, jsonCacheable } from '@/lib/store/http-cache';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /api/catalog/related?country=co&id=<uuid>&limit=3` — misma familia y género, en stock. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const pais = p.get('country')?.toLowerCase();
  const id = p.get('id') ?? '';
  const limite = Math.min(Math.max(Number(p.get('limit')) || 3, 1), 12);
  if (!esPais(pais) || !UUID.test(id)) return NextResponse.json({ error: 'parametros' }, { status: 400 });
  try {
    const items = await tienda().relacionados(pais, id, limite);
    return jsonCacheable(req, { items }, CACHE_CATALOGO.ficha);
  } catch {
    return NextResponse.json({ error: 'no-disponible' }, { status: 503 });
  }
}
