/** GET /api/admin/leads/exportar?<filtros de la lista>: leads en Excel. Solo administrador; la descarga se audita. */
import { NextResponse } from 'next/server';
import { auditarCambio } from '@/lib/admin/auditoria';
import { adminParaApiDe } from '@/lib/admin/crud/servidor';
import { TIPO_XLSX, crearLibroXlsx } from '@/lib/admin/excel/libro';
import { hojaLeads } from '@/lib/admin/leads/excel';
import { leerFiltrosLead, parametrosDeFiltrosLead } from '@/lib/admin/leads/leads';
import { todosLosLeads } from '@/lib/admin/leads/servidor';
import { ipDelCliente } from '@/lib/auth/cabeceras';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const admin = await adminParaApiDe('leads', 'leads.gestionar');
  if (admin instanceof NextResponse) return admin;
  const filtros = leerFiltrosLead(Object.fromEntries(new URL(request.url).searchParams));
  const { filas, truncado } = await todosLosLeads(crearClienteServicio(), filtros);

  // Se audita qué filtros se usaron y cuántos leads salieron, sin guardar el texto buscado (puede ser un correo).
  const { q, ...sinBusqueda } = parametrosDeFiltrosLead(filtros);
  await auditarCambio({
    actor: admin.userId,
    accion: 'leads.exportado',
    entidad: 'leads',
    diff: { filtros: sinBusqueda, con_busqueda: Boolean(q), filas: filas.length, truncado },
    ip: await ipDelCliente(),
  });

  const cuerpo = crearLibroXlsx([hojaLeads(filas)]);
  return new NextResponse(new Uint8Array(cuerpo), {
    headers: {
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
      ...(truncado ? { 'X-Izao-Truncado': '1' } : {}),
    },
  });
}
