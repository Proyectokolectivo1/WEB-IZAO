import type { Metadata } from 'next';
import Link from 'next/link';
import { FiltroFechas } from '@/components/admin/FiltroFechas';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { reporteInfluencers } from '@/lib/admin/descuentos/influencers-servidor';
import { dineroBig } from '@/lib/admin/formato';
import { hoyBogota, leerFiltroFechas, parametrosFechas } from '@/lib/admin/metricas/filtros';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Reporte de influencers' };

export default async function ReporteInfluencers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'influencers' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const ahora = new Date();
  const filtro = leerFiltroFechas(sp, ahora);
  const moneda = MONEDA_PAIS[pais];
  const reporte = await reporteInfluencers(crearClienteServicio(), { pais, ...filtro.rango });
  const descarga = new URLSearchParams({ pais, ...parametrosFechas(filtro) }).toString();

  return (
    <>
      <p className="adm-migas">
        <Link href={`/admin/influencers?pais=${pais}`}>Influencers</Link> / Reporte
      </p>
      <h1>Reporte de influencers</h1>
      <p className="adm-suave">
        Del {filtro.rango.desde} al {filtro.rango.hasta} (hora de Colombia). Cada pedido cuenta en la fecha de su pago, o
        en la de su creación si aún no se ha pagado. Montos en {moneda === 'COP' ? 'pesos colombianos' : 'dólares'}.
      </p>
      <PestanasPais base="/admin/influencers/reporte" actual={pais} />
      <FiltroFechas base="/admin/influencers/reporte" filtro={filtro} ocultos={{ pais }} hoy={hoyBogota(ahora)} />

      {reporte.filas.length === 0 ? (
        <p className="adm-vacio">Ningún pedido con influencer en este periodo.</p>
      ) : (
        <>
          <p>
            <a className="adm-enlace-boton adm-boton-secundario" href={`/api/admin/influencers/reporte?${descarga}`}>
              Descargar en Excel
            </a>
          </p>
          <div className="adm-tabla-caja">
            <table className="adm-tabla">
              <caption className="adm-suave">Ventas por influencer</caption>
              <thead>
                <tr>
                  <th scope="col">Influencer</th>
                  <th scope="col">Pedidos</th>
                  <th scope="col">Ventas brutas</th>
                  <th scope="col">Entregados</th>
                  <th scope="col">Devueltos</th>
                  <th scope="col">Ingresos confirmados</th>
                  <th scope="col">Ticket promedio</th>
                  <th scope="col">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {reporte.filas.map((f) => (
                  <tr key={f.influencerId}>
                    <td>
                      <Link href={`/admin/influencers/${f.influencerId}`}>{f.nombre}</Link>
                      {f.handle ? <span className="adm-suave"> @{f.handle}</span> : null}
                    </td>
                    <td>
                      {f.pedidos}
                      <span className="adm-suave"> ({f.pedidosPagados} pagados)</span>
                    </td>
                    <td>{dineroBig(f.ventasBrutas, f.moneda)}</td>
                    <td>{f.entregados}</td>
                    <td>{f.devueltos}</td>
                    <td>{dineroBig(f.ingresosConfirmados, f.moneda)}</td>
                    <td>{f.ticketPromedio === null ? '—' : dineroBig(f.ticketPromedio, f.moneda)}</td>
                    <td>
                      {f.comision === null ? (
                        <span className="adm-suave">Sin comisión</span>
                      ) : (
                        <>
                          {dineroBig(f.comision, f.moneda)}
                          <span className="adm-suave"> ({f.comisionPct} %)</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="adm-suave adm-chico">
            La comisión es el porcentaje de la ficha sobre los ingresos confirmados: prepagos enviados y contra entrega
            entregada (los devueltos aportan solo el abono).
          </p>
        </>
      )}
      {reporte.descartados > 0 ? (
        <p className="adm-alerta" role="alert">
          {reporte.descartados} pedido(s) no se contaron por tener un método o estado desconocido.
        </p>
      ) : null}
    </>
  );
}
