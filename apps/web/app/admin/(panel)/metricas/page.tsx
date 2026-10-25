import type { Metadata } from 'next';
import Link from 'next/link';
import { FiltroFechas } from '@/components/admin/FiltroFechas';
import { SeccionPaisMetricas } from '@/components/admin/metricas/SeccionPaisMetricas';
import { TarjetasKpi } from '@/components/admin/metricas/TarjetasKpi';
import { hoyBogota, leerFiltroFechas, parametrosFechas } from '@/lib/admin/metricas/filtros';
import { kpisDe } from '@/lib/admin/metricas/kpis';
import { leerPaisDashboard, ETIQUETA_PAIS_DASHBOARD, OPCIONES_PAIS_DASHBOARD } from '@/lib/admin/metricas/pais';
import { cargarDashboard } from '@/lib/admin/metricas/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Métricas' };

export default async function PaginaMetricas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'dashboard' });
  const sp = await searchParams;
  const ahora = new Date();
  const pais = leerPaisDashboard(sp.pais);
  const filtro = leerFiltroFechas(sp, ahora);
  const vista = await cargarDashboard(crearClienteServicio(), { pais, rango: filtro.rango, preset: filtro.preset });
  const fechas = parametrosFechas(filtro);
  const descarga = new URLSearchParams({ pais, ...fechas }).toString();

  return (
    <>
      <h1>Métricas</h1>
      <p className="adm-suave">
        Del {vista.rango.desde} al {vista.rango.hasta} (hora de Colombia), comparado con {vista.anterior.desde} al {vista.anterior.hasta}.
        Cada pedido cuenta en la fecha de su pago, o en la de su creación si aún no se ha pagado.
      </p>

      <div className="met-selector">
        <ul className="adm-pestanas" aria-label="País">
          {OPCIONES_PAIS_DASHBOARD.map((p) => (
            <li key={p}>
              <Link href={`/admin/metricas?${new URLSearchParams({ pais: p, ...fechas }).toString()}`} aria-current={p === pais ? 'page' : undefined}>
                {ETIQUETA_PAIS_DASHBOARD[p]}
              </Link>
            </li>
          ))}
        </ul>
        <a className="adm-enlace-boton adm-boton-secundario" href={`/api/admin/metricas/exportar?${descarga}`}>
          Exportar a Excel
        </a>
      </div>
      <FiltroFechas base="/admin/metricas" filtro={filtro} ocultos={{ pais }} hoy={hoyBogota(ahora)} />

      {vista.truncado ? (
        <p className="adm-alerta" role="alert">
          El periodo tiene más pedidos de los que se pueden leer de una vez: las cifras son parciales. Acorta el rango.
        </p>
      ) : null}

      {vista.coherencia && vista.coherencia.estadisticas !== vista.coherencia.panel ? (
        <p className="adm-aviso" role="status">
          Las cifras de ventas se actualizan cada minuto después de cada pedido y todavía no incluyen los últimos cambios (
          {vista.coherencia.panel} pedidos en el panel de guías frente a {vista.coherencia.estadisticas} en las estadísticas). Recarga en un momento.
        </p>
      ) : null}

      {vista.consolidado ? (
        'error' in vista.consolidado ? (
          <p className="adm-alerta" role="alert">
            No se puede consolidar en pesos: falta la tasa de cambio de {vista.consolidado.pais === 'EC' ? 'Ecuador' : 'Colombia'}.{' '}
            <Link href="/admin/pagos?pais=EC">Configúrala en Pagos y países</Link>. Mientras tanto se muestra cada país por separado.
          </p>
        ) : (
          <section aria-labelledby="met-consolidado" className="met-pais">
            <h2 id="met-consolidado">
              Consolidado <span className="adm-suave">(en pesos colombianos, con la tasa de cambio del panel)</span>
            </h2>
            <TarjetasKpi kpis={kpisDe(vista.consolidado.actual, vista.consolidado.anterior)} titulo="Indicadores consolidados" />
          </section>
        )
      ) : null}

      {vista.paises.map((v) => (
        <SeccionPaisMetricas key={v.actual.pais} vista={v} nombres={vista.nombres} rango={vista.rango} />
      ))}
    </>
  );
}
