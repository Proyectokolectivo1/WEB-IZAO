import { NextResponse } from 'next/server';
import { politicaVigente } from '@/lib/store/checkout-datos';
import { esPais } from '@/lib/store/pais';

/**
 * Términos y política de datos vigentes ahora mismo (sin caché). El checkout la consulta cuando el servidor responde
 * `DATA_POLICY_OUTDATED`: así la persona lee la versión nueva antes de volver a aceptar. Solo enlaces y versión públicos.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  if (!esPais(country)) return NextResponse.json({}, { status: 404 });
  try {
    const p = await politicaVigente(country);
    return NextResponse.json(p, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({}, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
