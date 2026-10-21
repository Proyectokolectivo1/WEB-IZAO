import type { Metadata } from 'next';
import Link from 'next/link';
import { AtajosPedidos } from '@/components/admin/AtajosPedidos';
import { FiltrosPedidos, ID_BUSQUEDA_PEDIDOS } from '@/components/admin/FiltrosPedidos';
import { Paginacion } from '@/components/admin/Paginacion';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_METODO_PAGO } from '@/lib/admin/pedidos/etiquetas';
import { dinero, listarPedidos } from '@/lib/admin/pedidos/detalle-servidor';
import { leerFiltrosPedido, parametrosDeFiltros } from '@/lib/admin/pedidos/filtros';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Pedidos' };

const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

export default async function PaginaPedidos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'pedidos', accion: 'pedidos.ver' });
  const filtros = leerFiltrosPedido(await searchParams);
  const parametros = parametrosDeFiltros(filtros);
  const hayFiltros = Object.keys(parametros).length > 0;
  const { filas, total } = await listarPedidos(crearClienteServicio(), filtros);

  return (
    <>
      <h1>Pedidos</h1>
      <AtajosPedidos idBusqueda={ID_BUSQUEDA_PEDIDOS} />
      <FiltrosPedidos filtros={filtros} />
      <p className="adm-suave adm-chico">
        Atajos: <kbd>/</kbd> buscar · <kbd>j</kbd> / <kbd>k</kbd> bajar y subir por la lista · <kbd>Enter</kbd> abrir el pedido
      </p>
      {filas.length === 0 ? (
        <p className="adm-vacio">{hayFiltros ? 'Ningún pedido coincide con esos filtros.' : 'Aún no hay pedidos.'}</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-suave">Pedidos más recientes primero</caption>
            <thead>
              <tr>
                <th scope="col">Pedido</th>
                <th scope="col">País</th>
                <th scope="col">Estado</th>
                <th scope="col">Pago</th>
                <th scope="col">Total</th>
                <th scope="col">Ciudad</th>
                <th scope="col">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`/admin/pedidos/${f.id}`} data-fila-pedido>
                      {f.number}
                    </Link>
                  </td>
                  <td>{f.country_code}</td>
                  <td>
                    <span className="adm-insignia">{ETIQUETA_ESTADO_PEDIDO[f.status] ?? f.status}</span>
                  </td>
                  <td>{ETIQUETA_METODO_PAGO[f.payment_method] ?? f.payment_method}</td>
                  <td>{dinero(f.total_customer, f.currency_code)}</td>
                  <td className="adm-suave">{f.shipping_city_name ?? '—'}</td>
                  <td className="adm-suave">{fecha.format(new Date(f.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/pedidos" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
