/** GET /api/admin/descuentos/exportar?pais=CO&prefijo=VERANO&formato=xlsx|csv: los códigos de un lote. */
import { NextResponse } from 'next/server';
import { descargaTabla, formatoDe } from '@/lib/admin/catalogo/archivo';
import { adminParaApiDe } from '@/lib/admin/crud/servidor';
import { ETIQUETA_ESTADO, estadoCodigo } from '@/lib/admin/descuentos/codigos';
import { codigosDeLote } from '@/lib/admin/descuentos/codigos-servidor';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const admin = await adminParaApiDe('descuentos', 'descuentos.gestionar');
  if (admin instanceof NextResponse) return admin;
  const url = new URL(request.url);
  const pais = url.searchParams.get('pais') === 'EC' ? 'EC' : 'CO';
  const prefijo = (url.searchParams.get('prefijo') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (prefijo.length < 2) return NextResponse.json({ error: 'prefijo-invalido' }, { status: 400 });
  const filas = await codigosDeLote(crearClienteServicio(), pais, prefijo);
  const ahora = new Date();
  const tabla = [
    ['codigo', 'estado', 'usos'],
    ...filas.map((f) => [f.code, ETIQUETA_ESTADO[estadoCodigo(f, ahora)], String(f.usage_count)]),
  ];
  const d = descargaTabla(tabla, formatoDe(url.searchParams.get('formato') ?? 'xlsx'), `lote-${prefijo}-${pais}`);
  return new NextResponse(new Uint8Array(d.cuerpo), {
    headers: { 'Content-Type': d.tipo, 'Content-Disposition': `attachment; filename="${d.nombre}"`, 'Cache-Control': 'no-store' },
  });
}
