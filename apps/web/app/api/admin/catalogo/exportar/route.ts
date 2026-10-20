/** GET /api/admin/catalogo/exportar?formato=csv|xlsx: todo el catálogo en el formato de importación. */
import { NextResponse } from 'next/server';
import { adminParaApi } from '@/lib/admin/catalogo/api-servidor';
import { descargaTabla, formatoDe } from '@/lib/admin/catalogo/archivo';
import { exportarCatalogo } from '@/lib/admin/catalogo/importacion-servidor';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  const admin = await adminParaApi('catalogo.importar');
  if (admin instanceof NextResponse) return admin;
  const formato = formatoDe(new URL(request.url).searchParams.get('formato'));
  const filas = await exportarCatalogo(crearClienteServicio());
  const d = descargaTabla(filas, formato, 'catalogo-izao');
  return new NextResponse(new Uint8Array(d.cuerpo), {
    headers: { 'Content-Type': d.tipo, 'Content-Disposition': `attachment; filename="${d.nombre}"`, 'Cache-Control': 'no-store' },
  });
}
