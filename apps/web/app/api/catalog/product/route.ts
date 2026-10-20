import { NextResponse, type NextRequest } from 'next/server';
import { tienda } from '@/lib/store/datos';
import { esPais } from '@/lib/store/pais';

/** `GET /api/catalog/product?country=co&slug=…` — ficha completa para la vista rápida y «Agregar» desde la tarjeta. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const pais = p.get('country')?.toLowerCase();
  const slug = p.get('slug') ?? '';
  if (!esPais(pais) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) {
    return NextResponse.json({ error: 'parametros' }, { status: 400 });
  }
  try {
    const ficha = await tienda().producto(pais, slug);
    if (!ficha) return NextResponse.json({ error: 'no-existe' }, { status: 404 });
    return NextResponse.json(ficha, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch {
    return NextResponse.json({ error: 'no-disponible' }, { status: 503 });
  }
}
