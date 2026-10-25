/**
 * GET /api/admin/garantias/archivo/{mediaId}?v=video|400|800…: foto o video de una garantía, solo con sesión del panel
 * y permiso `garantias.gestionar` (operador y administrador). Acepta `Range` para el video.
 */
import { NextResponse } from 'next/server';
import { adminParaApiDe } from '@/lib/admin/crud/servidor';
import { servirArchivoGarantia, type MediaGarantia } from '@/lib/admin/garantias/archivo';
import { raizMedia } from '@/lib/admin/media/guardar';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminParaApiDe('garantias', 'garantias.gestionar');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });
  const variante = new URL(request.url).searchParams.get('v') ?? '800';

  const { data } = await crearClienteServicio().from('media').select('kind, variants').eq('id', id).maybeSingle();
  const r = await servirArchivoGarantia({
    media: (data as MediaGarantia | null) ?? null,
    variante,
    rango: request.headers.get('range'),
    raiz: raizMedia(),
  });
  return new NextResponse(r.cuerpo, { status: r.status, headers: r.headers });
}
