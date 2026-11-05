/**
 * POST /api/admin/media: sube una imagen (multipart: `file`, `kind`, `alt`, `recorte45`, `variante` solo en banners)
 * Toda imagen se re-codifica a WebP en el servidor antes de guardarse (nunca se conserva el formato original).
 * Solo administradores (el middleware ya exige sesión aal2; aquí se repite el rol).
 */
import { NextResponse } from 'next/server';
import { esquemaSubida } from '@/lib/admin/media/esquema';
import { bytesMaximos } from '@/lib/admin/media/ajustes';
import { leerAjustesMedia } from '@/lib/admin/media/ajustes-servidor';
import { subirImagen } from '@/lib/admin/media/registrar';
import { requerirAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const admin = await requerirAdmin();
  if (admin.rol !== 'admin') return NextResponse.json({ error: 'sin-permiso' }, { status: 403 });

  const { ajustes } = await leerAjustesMedia();
  const longitud = Number(request.headers.get('content-length') ?? '0');
  if (longitud > bytesMaximos(ajustes) + 64 * 1024) {
    return NextResponse.json({ error: `La imagen supera los ${ajustes.maxMb} MB.` }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const archivo = form?.get('file');
  if (!form || !(archivo instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
  }
  const datos = esquemaSubida.safeParse({
    kind: form.get('kind'),
    alt: form.get('alt'),
    variante: form.get('variante'),
    recorte45: form.get('recorte45'),
  });
  if (!datos.success) {
    const campos = Object.fromEntries(datos.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
    return NextResponse.json({ error: 'Revisa los datos.', campos }, { status: 400 });
  }

  const resultado = await subirImagen({
    buffer: Buffer.from(await archivo.arrayBuffer()),
    nombre: archivo.name,
    datos: datos.data,
    actor: admin.userId,
    ip: request.headers.get('x-real-ip')?.trim() ?? null,
  });
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado.media, { status: 201 });
}
