/**
 * POST /api/admin/catalogo/importar (multipart: `archivo` .csv/.xlsx, `modo` simular|aplicar).
 * Devuelve el reporte de la simulación o de la aplicación. Solo administradores (`catalogo.importar`).
 */
import { NextResponse } from 'next/server';
import { adminParaApi } from '@/lib/admin/catalogo/api-servidor';
import { ErrorArchivo, MAX_BYTES_TABLA, leerTablaDeArchivo } from '@/lib/admin/catalogo/archivo';
import { procesarImportacion } from '@/lib/admin/catalogo/importacion-servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const admin = await adminParaApi('catalogo.importar');
  if (admin instanceof NextResponse) return admin;

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES_TABLA + 64 * 1024) {
    return NextResponse.json({ error: 'El archivo supera los 10 MB. Divídelo en partes.' }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const archivo = form?.get('archivo');
  const modo = form?.get('modo');
  if (!form || !(archivo instanceof File) || (modo !== 'simular' && modo !== 'aplicar')) {
    return NextResponse.json({ error: 'Falta el archivo o el modo.' }, { status: 400 });
  }
  let tabla: string[][];
  try {
    tabla = leerTablaDeArchivo(archivo.name, Buffer.from(await archivo.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErrorArchivo ? e.message : 'No se pudo leer el archivo.' }, { status: 400 });
  }
  const reporte = await procesarImportacion({
    modo,
    tabla,
    cliente: crearClienteServicio(),
    actor: admin.userId,
    ip: await ipDelCliente(),
  });
  if ('error' in reporte) return NextResponse.json({ error: reporte.error }, { status: 400 });
  return NextResponse.json(reporte);
}
