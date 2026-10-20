/**
 * POST /api/admin/catalogo/imagenes (multipart: varios `archivos`: imágenes `SKU_1.jpg`, `SKU_2.jpg`... o un .zip).
 * Asocia cada imagen al producto de su SKU: 1 = principal, 2 = cursor, 3 en adelante = galería.
 */
import { NextResponse } from 'next/server';
import { adminParaApi } from '@/lib/admin/catalogo/api-servidor';
import { adjuntarImagenesPorSku } from '@/lib/admin/catalogo/importacion-servidor';
import { ErrorZip, leerZip } from '@/lib/admin/catalogo/zip';
import { MAX_BYTES } from '@/lib/admin/media/validar';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_ARCHIVOS_POR_ENVIO = 60;
const MAX_ZIP = 300 * 1024 * 1024;

export async function POST(request: Request) {
  const admin = await adminParaApi('catalogo.importar');
  if (admin instanceof NextResponse) return admin;

  const form = await request.formData().catch(() => null);
  const subidos = (form?.getAll('archivos') ?? []).filter((f): f is File => f instanceof File);
  if (subidos.length === 0) return NextResponse.json({ error: 'Falta al menos un archivo.' }, { status: 400 });
  if (subidos.length > MAX_ARCHIVOS_POR_ENVIO) {
    return NextResponse.json({ error: `Máximo ${MAX_ARCHIVOS_POR_ENVIO} archivos por envío.` }, { status: 400 });
  }

  const archivos: { nombre: string; datos: Buffer }[] = [];
  try {
    for (const f of subidos) {
      if (f.name.toLowerCase().endsWith('.zip')) {
        if (f.size > MAX_ZIP) return NextResponse.json({ error: 'El ZIP supera los 300 MB.' }, { status: 413 });
        const entradas = leerZip(Buffer.from(await f.arrayBuffer()), {
          maxEntradas: 500,
          maxBytesEntrada: MAX_BYTES,
          maxBytesTotal: MAX_ZIP,
        });
        for (const e of entradas) {
          const base = e.nombre.split('/').pop() ?? '';
          if (!base.startsWith('.') && !e.nombre.startsWith('__MACOSX/')) archivos.push({ nombre: base, datos: e.datos });
        }
      } else {
        if (f.size > MAX_BYTES) return NextResponse.json({ error: `${f.name} supera los 15 MB.` }, { status: 413 });
        archivos.push({ nombre: f.name, datos: Buffer.from(await f.arrayBuffer()) });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErrorZip ? e.message : 'No se pudo leer el ZIP.' }, { status: 400 });
  }
  if (archivos.length > 500) return NextResponse.json({ error: 'Máximo 500 imágenes por carga.' }, { status: 400 });

  const reporte = await adjuntarImagenesPorSku({
    archivos,
    cliente: crearClienteServicio(),
    actor: admin.userId,
    ip: await ipDelCliente(),
  });
  return NextResponse.json(reporte);
}
