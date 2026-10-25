/** GET /api/admin/gastos/exportar?pais=CO&rango=este_mes | desde=…&hasta=…&categoria=…&origen=…: gastos en Excel. */
import { NextResponse } from 'next/server';
import { fromDbAmount } from '@izao/core/money';
import { adminParaApiDe } from '@/lib/admin/crud/servidor';
import { TIPO_XLSX, crearLibroXlsx } from '@/lib/admin/excel/libro';
import { ETIQUETA_ORIGEN_GASTO, leerFiltrosGasto } from '@/lib/admin/gastos/gastos';
import { todosLosGastos, totalesPorCategoria } from '@/lib/admin/gastos/servidor';
import { leerFiltroFechas } from '@/lib/admin/metricas/filtros';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const admin = await adminParaApiDe('gastos', 'gastos.gestionar');
  if (admin instanceof NextResponse) return admin;
  const url = new URL(request.url);
  const pais = url.searchParams.get('pais') === 'EC' ? 'EC' : 'CO';
  const moneda = MONEDA_PAIS[pais];
  const sp = Object.fromEntries(url.searchParams);
  const fechas = leerFiltroFechas(sp, new Date());
  const filtros = leerFiltrosGasto(sp);
  const cliente = crearClienteServicio();

  const { filas } = await todosLosGastos(cliente, pais, fechas.rango, filtros);
  const totales = await totalesPorCategoria(cliente, pais, fechas.rango, filtros);

  const cuerpo = crearLibroXlsx([
    {
      nombre: 'Gastos',
      columnas: [
        { titulo: 'Fecha', ancho: 14 },
        { titulo: 'Categoría', ancho: 24 },
        { titulo: 'Descripción', ancho: 40 },
        { titulo: 'Origen', ancho: 22 },
        { titulo: `Valor (${moneda})`, ancho: 18 },
      ],
      filas: filas.map((g) => [
        g.date,
        g.expense_categories?.name ?? '',
        g.description ?? '',
        ETIQUETA_ORIGEN_GASTO[g.source] ?? g.source,
        { tipo: 'monto', valor: fromDbAmount(g.amount), moneda: g.currency_code },
      ]),
    },
    {
      nombre: 'Por categoría',
      columnas: [{ titulo: 'Categoría', ancho: 28 }, { titulo: `Total (${moneda})`, ancho: 20 }],
      filas: [
        ...totales.filas.map((t) => [t.nombre, { tipo: 'monto' as const, valor: t.total, moneda }]),
        ['Total', { tipo: 'monto' as const, valor: totales.total, moneda }],
      ],
    },
  ]);
  return new NextResponse(new Uint8Array(cuerpo), {
    headers: {
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="gastos-${pais}-${fechas.rango.desde}_${fechas.rango.hasta}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
