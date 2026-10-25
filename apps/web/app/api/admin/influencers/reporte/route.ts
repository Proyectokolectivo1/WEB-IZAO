/** GET /api/admin/influencers/reporte?pais=CO&rango=este_mes | desde=…&hasta=…: reporte por influencer en Excel. */
import { NextResponse } from 'next/server';
import { adminParaApiDe } from '@/lib/admin/crud/servidor';
import { porcentajeACentesimas } from '@/lib/admin/descuentos/influencers';
import { reporteInfluencers } from '@/lib/admin/descuentos/influencers-servidor';
import { TIPO_XLSX, crearLibroXlsx } from '@/lib/admin/excel/libro';
import { leerFiltroFechas } from '@/lib/admin/metricas/filtros';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const admin = await adminParaApiDe('influencers', 'influencers.gestionar');
  if (admin instanceof NextResponse) return admin;
  const url = new URL(request.url);
  const pais = url.searchParams.get('pais') === 'EC' ? 'EC' : 'CO';
  const filtro = leerFiltroFechas(Object.fromEntries(url.searchParams), new Date());
  const moneda = MONEDA_PAIS[pais];
  const reporte = await reporteInfluencers(crearClienteServicio(), { pais, ...filtro.rango });

  const cuerpo = crearLibroXlsx([
    {
      nombre: 'Influencers',
      columnas: [
        { titulo: 'Influencer', ancho: 28 },
        { titulo: 'Usuario', ancho: 20 },
        { titulo: 'Pedidos' },
        { titulo: 'Pedidos pagados' },
        { titulo: `Ventas brutas (${moneda})`, ancho: 20 },
        { titulo: 'Entregados' },
        { titulo: 'Devueltos' },
        { titulo: `Ingresos confirmados (${moneda})`, ancho: 24 },
        { titulo: `Ticket promedio (${moneda})`, ancho: 22 },
        { titulo: 'Comisión %' },
        { titulo: `Comisión calculada (${moneda})`, ancho: 24 },
      ],
      filas: reporte.filas.map((f) => [
        f.nombre,
        f.handle ?? '',
        { tipo: 'entero', valor: f.pedidos },
        { tipo: 'entero', valor: f.pedidosPagados },
        { tipo: 'monto', valor: f.ventasBrutas, moneda: f.moneda },
        { tipo: 'entero', valor: f.entregados },
        { tipo: 'entero', valor: f.devueltos },
        { tipo: 'monto', valor: f.ingresosConfirmados, moneda: f.moneda },
        f.ticketPromedio === null ? null : { tipo: 'monto', valor: f.ticketPromedio, moneda: f.moneda },
        f.comisionPct === null ? null : { tipo: 'bp', valor: BigInt(porcentajeACentesimas(String(f.comisionPct)) ?? 0) },
        f.comision === null ? null : { tipo: 'monto', valor: f.comision, moneda: f.moneda },
      ]),
    },
  ]);
  return new NextResponse(new Uint8Array(cuerpo), {
    headers: {
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="influencers-${pais}-${filtro.rango.desde}_${filtro.rango.hasta}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
