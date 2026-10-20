import { NextResponse, type NextRequest } from 'next/server';
import { ciudadesDe } from '@/lib/store/checkout-datos';
import { esPais } from '@/lib/store/pais';

/** Municipios (CO) o cantones (EC) de una región del país. Lista pública y estable: se cachea un día. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const region = req.nextUrl.searchParams.get('region') ?? '';
  if (!esPais(country) || !region || region.length > 64) return NextResponse.json({ ciudades: [] }, { status: 400 });
  try {
    const ciudades = await ciudadesDe(country, region);
    if (!ciudades) return NextResponse.json({ ciudades: [] }, { status: 404 });
    return NextResponse.json({ ciudades }, { headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' } });
  } catch {
    return NextResponse.json({ ciudades: [] }, { status: 500 });
  }
}
