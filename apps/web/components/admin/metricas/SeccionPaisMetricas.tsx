import Link from 'next/link';
import { METODOS_PAGO, type RangoFechas } from '@izao/core/metrics';
import { dineroBig, porcentajeBp } from '@/lib/admin/formato';
import { anchoRelativo } from '@/lib/admin/metricas/formato';
import { kpisDe } from '@/lib/admin/metricas/kpis';
import type { PaisVista, VistaDashboard } from '@/lib/admin/metricas/servidor';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_METODO_PAGO } from '@/lib/admin/pedidos/etiquetas';
import { GraficaDiaria } from './GraficaDiaria';
import { TarjetasKpi } from './TarjetasKpi';

const NOMBRE_PAIS = { CO: 'Colombia', EC: 'Ecuador' } as const;

/** Estados del pedido que el panel de guías muestra como contadores, en el orden del flujo. */
const ESTADOS_PANEL = [
  'esperando_abono',
  'abandonado',
  'pendiente_manual',
  'error_transportadora',
  'enviado_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
] as const;

function enlacePedidos(pais: string, rango: RangoFechas, extra: Record<string, string>): string {
  return `/admin/pedidos?${new URLSearchParams({ pais, desde: rango.desde, hasta: rango.hasta, ...extra }).toString()}`;
}

function Tabla({ titulo, vacio, encabezados, children }: { titulo: string; vacio: boolean; encabezados: readonly string[]; children: React.ReactNode }) {
  return (
    <div>
      <h3>{titulo}</h3>
      {vacio ? (
        <p className="adm-vacio">Sin datos en este periodo.</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-visualmente-oculto">{titulo}</caption>
            <thead>
              <tr>
                {encabezados.map((e) => (
                  <th key={e} scope="col">
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SeccionPaisMetricas({ vista, nombres, rango }: { vista: PaisVista; nombres: VistaDashboard['nombres']; rango: RangoFechas }) {
  const { actual: m, anterior } = vista;
  const r = m.resumen;
  const moneda = m.moneda;
  const pais = m.pais;
  const din = (v: bigint) => dineroBig(v, moneda);
  const maxEmbudo = r.embudo.sesiones;
  const pasos: [string, bigint][] = [
    ['Sesiones', r.embudo.sesiones],
    ['Vistas de producto', r.embudo.vistasProducto],
    ['Agregados al carrito', r.embudo.carrito],
    ['Checkouts iniciados', r.embudo.checkouts],
    ['Pedidos pagados', r.embudo.pagados],
  ];
  const g = m.guias;

  return (
    <section className="met-pais" aria-labelledby={`met-${pais}`}>
      <h2 id={`met-${pais}`}>
        {NOMBRE_PAIS[pais]} <span className="adm-suave">({moneda === 'COP' ? 'pesos colombianos' : 'dólares'})</span>
      </h2>
      <TarjetasKpi kpis={kpisDe(r, anterior.resumen)} titulo={`Indicadores de ${NOMBRE_PAIS[pais]}`} />
      {m.descartados > 0 ? (
        <p className="adm-alerta" role="alert">
          {m.descartados} pedido(s) no se contaron por tener un método, estado o moneda desconocidos.
        </p>
      ) : null}

      <GraficaDiaria serie={m.serie} moneda={moneda} titulo={`Ventas e ingresos por día, ${NOMBRE_PAIS[pais]}`} />

      <div className="met-dos">
        <div>
          <h3>Embudo de conversión</h3>
          {maxEmbudo === 0n ? (
            <p className="adm-vacio">Sin sesiones registradas en el periodo. El tráfico se vuelca cada hora desde la tienda.</p>
          ) : (
            <ol className="met-embudo">
              {pasos.map(([nombre, valor]) => (
                <li key={nombre}>
                  <span>
                    {nombre}: <strong>{valor.toString()}</strong>
                  </span>
                  <span className="met-barra-caja" aria-hidden="true">
                    <span className="met-barra-relleno" style={{ width: `${anchoRelativo(valor, maxEmbudo)}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <Tabla titulo="Ventas por método de pago" vacio={r.pedidosPagados === 0} encabezados={['Método', 'Pedidos pagados', 'Ventas brutas', 'Recargos cobrados']}>
          {METODOS_PAGO.filter((x) => r.porMetodo[x].pedidosPagados > 0).map((x) => (
            <tr key={x}>
              <th scope="row">{ETIQUETA_METODO_PAGO[x] ?? x}</th>
              <td>{r.porMetodo[x].pedidosPagados}</td>
              <td>{din(r.porMetodo[x].ventasBrutas)}</td>
              <td>{din(r.porMetodo[x].recargos)}</td>
            </tr>
          ))}
        </Tabla>
      </div>

      <div>
        <h3>Pedidos por estado de guía</h3>
        <p className="adm-suave adm-chico">
          Pedidos del periodo. Cada número abre la lista de pedidos; la lista filtra por fecha de creación, así que un pedido pagado
          días después de crearse puede no aparecer en el mismo periodo.
        </p>
        <ul className="met-contadores">
          {ESTADOS_PANEL.map((e) => (
            <li key={e}>
              <Link href={enlacePedidos(pais, rango, { estado: e })} className="met-contador">
                <strong>{g.porEstadoPedido[e] ?? 0}</strong>
                <span>{ETIQUETA_ESTADO_PEDIDO[e] ?? e}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={enlacePedidos(pais, rango, { novedad: '1' })} className="met-contador">
              <strong>{g.conNovedad}</strong>
              <span>Con novedad</span>
            </Link>
          </li>
        </ul>
        {g.porGrupo.length > 0 ? (
          <>
            <h4>Por grupo de la transportadora</h4>
            <ul className="met-contadores">
              {g.porGrupo.map((x) => (
                <li key={x.grupo}>
                  <Link href={enlacePedidos(pais, rango, { grupo: x.grupo })} className="met-contador">
                    <strong>{x.cantidad}</strong>
                    <span>{x.grupo}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <h4>Por estado de la guía</h4>
            <ul className="met-contadores">
              {g.porEstadoGuia.map((x) => (
                <li key={`${x.grupo}|${x.estado}`}>
                  <Link href={enlacePedidos(pais, rango, { guia: x.estado })} className="met-contador">
                    <strong>{x.cantidad}</strong>
                    <span>{x.estado}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="adm-suave adm-chico">Aún no hay guías de MasterShop en estos pedidos.</p>
        )}
      </div>

      <div className="met-dos">
        <Tabla titulo="Top de ciudades" vacio={m.ciudades.length === 0} encabezados={['Ciudad', 'Pedidos', 'Ventas', '% devolución']}>
          {m.ciudades.map((c) => (
            <tr key={c.clave}>
              <th scope="row">
                {c.ciudad} <span className="adm-suave">{c.departamento}</span>
              </th>
              <td>{c.pedidos}</td>
              <td>{din(c.ventasBrutas)}</td>
              <td>{porcentajeBp(c.devolucionBp)}</td>
            </tr>
          ))}
        </Tabla>
        <Tabla titulo="Top de departamentos" vacio={m.departamentos.length === 0} encabezados={['Departamento', 'Pedidos', 'Ventas', '% devolución']}>
          {m.departamentos.map((c) => (
            <tr key={c.departamento}>
              <th scope="row">{c.departamento}</th>
              <td>{c.pedidos}</td>
              <td>{din(c.ventasBrutas)}</td>
              <td>{porcentajeBp(c.devolucionBp)}</td>
            </tr>
          ))}
        </Tabla>
      </div>

      <Tabla titulo="Top de productos" vacio={m.productos.length === 0} encabezados={['Producto', 'Unidades', 'Ventas', 'Costo', 'Utilidad']}>
        {m.productos.map((p) => (
          <tr key={p.clave}>
            <th scope="row">{p.nombre}</th>
            <td>{p.unidades}</td>
            <td>{din(p.ventas)}</td>
            <td>{din(p.costo)}</td>
            <td>
              {din(p.utilidad)}
              {p.unidadesSinCosto > 0 ? <span className="adm-suave adm-chico"> ({p.unidadesSinCosto} u. sin costo cargado)</span> : null}
            </td>
          </tr>
        ))}
      </Tabla>

      <div className="met-dos">
        <Tabla titulo="Ventas por código de descuento" vacio={m.codigos.length === 0} encabezados={['Código', 'Pedidos pagados', 'Ventas', 'Ingresos']}>
          {m.codigos.map((c) => (
            <tr key={c.clave}>
              <th scope="row">{nombres.codigos[c.clave] ?? '(eliminado)'}</th>
              <td>{c.pagados}</td>
              <td>{din(c.ventasBrutas)}</td>
              <td>{din(c.ingresosConfirmados)}</td>
            </tr>
          ))}
        </Tabla>
        <Tabla titulo="Ventas por influencer" vacio={m.influencers.length === 0} encabezados={['Influencer', 'Pedidos pagados', 'Ventas', 'Ingresos']}>
          {m.influencers.map((c) => (
            <tr key={c.clave}>
              <th scope="row">
                <Link href={`/admin/influencers/${c.clave}`}>{nombres.influencers[c.clave] ?? '(eliminado)'}</Link>
              </th>
              <td>{c.pagados}</td>
              <td>{din(c.ventasBrutas)}</td>
              <td>{din(c.ingresosConfirmados)}</td>
            </tr>
          ))}
        </Tabla>
      </div>

      <Tabla titulo="Ventas por fuente" vacio={m.fuentes.length === 0} encabezados={['Fuente', 'Pedidos', 'Pagados', 'Ventas', 'Ingresos']}>
        {m.fuentes.map((f) => (
          <tr key={f.clave}>
            <th scope="row">{f.clave}</th>
            <td>{f.pedidos}</td>
            <td>{f.pagados}</td>
            <td>{din(f.ventasBrutas)}</td>
            <td>{din(f.ingresosConfirmados)}</td>
          </tr>
        ))}
      </Tabla>
    </section>
  );
}
