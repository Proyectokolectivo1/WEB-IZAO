/** GET /api/admin/catalogo/plantilla?formato=csv|xlsx: encabezados de §24.2, sin filas de ejemplo. */
import { NextResponse } from 'next/server';
import { adminParaApi } from '@/lib/admin/catalogo/api-servidor';
import { descargaTabla, formatoDe } from '@/lib/admin/catalogo/archivo';
import { COLUMNAS } from '@/lib/admin/catalogo/importacion';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const admin = await adminParaApi('catalogo.importar');
  if (admin instanceof NextResponse) return admin;
  const d = descargaTabla([[...COLUMNAS]], formatoDe(new URL(request.url).searchParams.get('formato')), 'plantilla-catalogo-izao');
  return new NextResponse(new Uint8Array(d.cuerpo), {
    headers: { 'Content-Type': d.tipo, 'Content-Disposition': `attachment; filename="${d.nombre}"`, 'Cache-Control': 'no-store' },
  });
}
