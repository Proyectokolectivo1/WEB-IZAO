import type { Metadata } from 'next';
import Link from 'next/link';
import { BuscadorLista } from '@/components/admin/BuscadorLista';
import { Paginacion } from '@/components/admin/Paginacion';
import { leerParametrosLista } from '@/lib/admin/crud/comun';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_METODO_PAGO } from '@/lib/admin/pedidos/etiquetas';
import { dinero, listarPedidos } from '@/lib/admin/pedidos/detalle-servidor';
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
  const { q, pagina } = leerParametrosLista(await searchParams);
  const { filas, total } = await listarPedidos(crearClienteServicio(), { q, pagina });

  return (
    <>
      <h1>Pedidos</h1>
      <BuscadorLista q={q} etiqueta="Buscar por número de pedido" limpiarHref="/admin/pedidos" />
      {filas.length === 0 ? (
        <p className="adm-vacio">{q ? 'No hay pedidos con ese número.' : 'Aún no hay pedidos.'}</p>
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
                    <Link href={`/admin/pedidos/${f.id}`}>{f.number}</Link>
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
      <Paginacion base="/admin/pedidos" total={total} pagina={pagina} parametros={q ? { q } : {}} />
    </>
  );
}
