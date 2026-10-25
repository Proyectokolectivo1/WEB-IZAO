/** GET /api/admin/metricas/exportar?pais=TODOS|CO|EC&rango=este_mes | desde=…&hasta=…: dashboard completo en Excel. */
import { NextResponse } from 'next/server';
import { adminParaApiDe } from '@/lib/admin/crud/servidor';
import { TIPO_XLSX, crearLibroXlsx } from '@/lib/admin/excel/libro';
import { hojasDelDashboard } from '@/lib/admin/metricas/excel';
import { leerFiltroFechas } from '@/lib/admin/metricas/filtros';
import { leerPaisDashboard } from '@/lib/admin/metricas/pais';
import { cargarDashboardDetallado } from '@/lib/admin/metricas/servidor';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const admin = await adminParaApiDe('dashboard', 'metricas.exportar');
  if (admin instanceof NextResponse) return admin;
  const url = new URL(request.url);
  const pais = leerPaisDashboard(url.searchParams.get('pais') ?? undefined);
  const filtro = leerFiltroFechas(Object.fromEntries(url.searchParams), new Date());
  const vista = await cargarDashboardDetallado(crearClienteServicio(), { pais, rango: filtro.rango, preset: filtro.preset });
  const cuerpo = crearLibroXlsx(hojasDelDashboard(vista));
  return new NextResponse(new Uint8Array(cuerpo), {
    headers: {
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="metricas-${pais}-${filtro.rango.desde}_${filtro.rango.hasta}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
