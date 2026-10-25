import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { dineroBig } from '@/lib/admin/formato';
import {
  ESTADOS_GARANTIA,
  ETIQUETA_ESTADO_GARANTIA,
  ETIQUETA_RESOLUCION,
  leerFiltrosGarantia,
  parametrosDeFiltrosGarantia,
  type Resolucion,
} from '@/lib/admin/garantias/garantias';
import { contarPorEstado, listarGarantias } from '@/lib/admin/garantias/servidor';
import { MONEDA_PAIS } from '@/lib/admin/pagos/ajustes';
import { fromDbAmount } from '@izao/core/money';
import { requerirAdmin } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/permissions';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Garantías' };

const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

export default async function PaginaGarantias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requerirAdmin({ modulo: 'garantias', accion: 'garantias.gestionar' });
  const filtros = leerFiltrosGarantia(await searchParams);
  const parametros = parametrosDeFiltrosGarantia(filtros);
  const cliente = crearClienteServicio();
  const [{ filas, total }, conteo] = await Promise.all([listarGarantias(cliente, filtros), contarPorEstado(cliente, filtros.pais)]);
  const sinEstado = { ...parametros };
  delete sinEstado.estado;
  const href = (extra: Record<string, string>) => `/admin/garantias?${new URLSearchParams({ ...sinEstado, ...extra }).toString()}`;

  return (
    <>
      <div className="adm-cabecera">
        <h1>Garantías</h1>
        {puede(admin.rol, 'garantias.ajustes') ? (
          <Link href="/admin/garantias/ajustes" className="adm-enlace-boton adm-boton-secundario">
            Plazos, motivos y textos
          </Link>
        ) : null}
      </div>

      <ul className="adm-pestanas" aria-label="Estado">
        <li>
          <Link href={href({})} aria-current={filtros.estado === '' ? 'page' : undefined}>
            Todas
          </Link>
        </li>
        {ESTADOS_GARANTIA.map((e) => (
          <li key={e}>
            <Link href={href({ estado: e })} aria-current={filtros.estado === e ? 'page' : undefined}>
              {ETIQUETA_ESTADO_GARANTIA[e]} ({conteo[e]})
            </Link>
          </li>
        ))}
      </ul>

      <form className="adm-busqueda adm-filtros" role="search" method="get" action="/admin/garantias">
        {filtros.estado ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
        <div className="adm-campo">
          <label htmlFor="g-q" className="adm-etiqueta">
            Caso, celular o nombre
          </label>
          <input id="g-q" name="q" className="adm-input" defaultValue={filtros.q} maxLength={100} placeholder="GAR-CO-0001" />
        </div>
        <div className="adm-campo">
          <label htmlFor="g-pais" className="adm-etiqueta">
            País
          </label>
          <select id="g-pais" name="pais" className="adm-input" defaultValue={filtros.pais}>
            <option value="">Todos</option>
            <option value="CO">Colombia</option>
            <option value="EC">Ecuador</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="g-desde" className="adm-etiqueta">
            Desde
          </label>
          <input id="g-desde" name="desde" type="date" className="adm-input" defaultValue={filtros.desde} />
        </div>
        <div className="adm-campo">
          <label htmlFor="g-hasta" className="adm-etiqueta">
            Hasta
          </label>
          <input id="g-hasta" name="hasta" type="date" className="adm-input" defaultValue={filtros.hasta} />
        </div>
        <label className="adm-check">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={filtros.vencidas} />
          Solo con respuesta vencida
        </label>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
        <Link className="adm-enlace-boton adm-boton-secundario" href="/admin/garantias">
          Limpiar
        </Link>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">{Object.keys(parametros).length > 0 ? 'Ninguna garantía coincide con esos filtros.' : 'Aún no hay solicitudes de garantía.'}</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-suave">Solicitudes más recientes primero</caption>
            <thead>
              <tr>
                <th scope="col">Caso</th>
                <th scope="col">Cliente</th>
                <th scope="col">Motivo</th>
                <th scope="col">Estado</th>
                <th scope="col">Solución</th>
                <th scope="col">Costo asumido</th>
                <th scope="col">Recibida</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/admin/garantias/${g.id}`}>{g.number}</Link>
                  </td>
                  <td>
                    {g.customer_name}
                    <span className="adm-suave adm-chico"> · {g.phone}</span>
                  </td>
                  <td>{g.reason}</td>
                  <td>
                    <span className="adm-insignia">{ETIQUETA_ESTADO_GARANTIA[g.status]}</span>
                    {g.vencida ? <span className="adm-insignia adm-insignia-aviso"> Respuesta vencida</span> : null}
                  </td>
                  <td className="adm-suave">{g.resolution ? (ETIQUETA_RESOLUCION[g.resolution as Resolucion] ?? g.resolution) : '—'}</td>
                  <td>{dineroBig(fromDbAmount(g.cost_amount), MONEDA_PAIS[g.country_code])}</td>
                  <td className="adm-suave">{fecha.format(new Date(g.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/garantias" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
