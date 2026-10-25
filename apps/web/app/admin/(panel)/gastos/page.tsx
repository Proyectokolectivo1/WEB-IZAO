import type { Metadata } from 'next';
import Link from 'next/link';
import { FiltroFechas } from '@/components/admin/FiltroFechas';
import { Paginacion } from '@/components/admin/Paginacion';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { fromDbAmount } from '@izao/core/money';
import { dineroBig } from '@/lib/admin/formato';
import { ETIQUETA_ORIGEN_GASTO, ORIGENES_GASTO, leerFiltrosGasto, parametrosDeFiltrosGasto } from '@/lib/admin/gastos/gastos';
import { listarCategoriasGasto, listarGastos, totalesPorCategoria } from '@/lib/admin/gastos/servidor';
import { hoyBogota, leerFiltroFechas, parametrosFechas } from '@/lib/admin/metricas/filtros';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Gastos' };

export default async function PaginaGastos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'gastos', accion: 'gastos.gestionar' });
  const sp = await searchParams;
  const ahora = new Date();
  const pais = leerPais(sp.pais);
  const fechas = leerFiltroFechas(sp, ahora);
  const filtros = leerFiltrosGasto(sp);
  const moneda = MONEDA_PAIS[pais];
  const cliente = crearClienteServicio();
  const [{ filas, total }, totales, categorias] = await Promise.all([
    listarGastos(cliente, pais, fechas.rango, filtros),
    totalesPorCategoria(cliente, pais, fechas.rango, filtros),
    listarCategoriasGasto(cliente),
  ]);
  const parametros = { pais, ...parametrosFechas(fechas), ...parametrosDeFiltrosGasto(filtros) };
  const descarga = new URLSearchParams(parametros).toString();
  const ocultos: Record<string, string> = { pais, ...parametrosDeFiltrosGasto(filtros) };

  return (
    <>
      <div className="adm-cabecera">
        <h1>Gastos</h1>
        <div className="adm-acciones">
          <Link href={`/admin/gastos/categorias`} className="adm-enlace-boton adm-boton-secundario">
            Categorías
          </Link>
          <Link href={`/admin/gastos/nuevo?pais=${pais}`} className="adm-enlace-boton">
            Registrar gasto
          </Link>
        </div>
      </div>
      <p className="adm-suave">
        Del {fechas.rango.desde} al {fechas.rango.hasta}. Los gastos de Meta Ads y de la billetera de MasterShop los trae el
        sistema; aquí se registran y editan los manuales. Todo suma a la utilidad neta del dashboard.
      </p>
      {sp.guardado ? <p className="adm-ok" role="status">Gasto guardado.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Gasto eliminado.</p> : null}

      <PestanasPais base="/admin/gastos" actual={pais} />
      <FiltroFechas base="/admin/gastos" filtro={fechas} ocultos={ocultos} hoy={hoyBogota(ahora)} />

      <form className="adm-busqueda adm-filtros" method="get" action="/admin/gastos" aria-label="Filtros de gastos">
        <input type="hidden" name="pais" value={pais} />
        {Object.entries(parametrosFechas(fechas)).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="adm-campo">
          <label htmlFor="f-categoria" className="adm-etiqueta">
            Categoría
          </label>
          <select id="f-categoria" name="categoria" className="adm-input" defaultValue={filtros.categoria}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="f-origen" className="adm-etiqueta">
            Origen
          </label>
          <select id="f-origen" name="origen" className="adm-input" defaultValue={filtros.origen}>
            <option value="">Todos</option>
            {ORIGENES_GASTO.map((o) => (
              <option key={o} value={o}>
                {ETIQUETA_ORIGEN_GASTO[o]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
      </form>

      <section aria-labelledby="h-totales">
        <h2 id="h-totales">
          Total del periodo: {dineroBig(totales.total, moneda)}
        </h2>
        {totales.truncado ? (
          <p className="adm-alerta" role="alert">
            Hay más gastos de los que se pueden sumar de una vez: el total es parcial. Acorta el rango.
          </p>
        ) : null}
        {totales.filas.length === 0 ? null : (
          <ul className="adm-lista-simple">
            {totales.filas.map((t) => (
              <li key={t.categoriaId}>
                {t.nombre}: <strong>{dineroBig(t.total, moneda)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      {filas.length === 0 ? (
        <p className="adm-vacio">No hay gastos con esos filtros.</p>
      ) : (
        <>
          <p>
            <a className="adm-enlace-boton adm-boton-secundario" href={`/api/admin/gastos/exportar?${descarga}`}>
              Descargar en Excel
            </a>
          </p>
          <div className="adm-tabla-caja">
            <table className="adm-tabla">
              <caption className="adm-suave">Gastos más recientes primero</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Categoría</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Origen</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((g) => (
                  <tr key={g.id}>
                    <td>
                      {g.source === 'manual' ? <Link href={`/admin/gastos/${g.id}`}>{g.date}</Link> : g.date}
                    </td>
                    <td>{g.expense_categories?.name ?? '—'}</td>
                    <td className="adm-suave">{g.description ?? '—'}</td>
                    <td>
                      <span className="adm-insignia">{ETIQUETA_ORIGEN_GASTO[g.source] ?? g.source}</span>
                    </td>
                    <td>{dineroBig(fromDbAmount(g.amount), g.currency_code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Paginacion base="/admin/gastos" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
