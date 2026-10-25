import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { ETIQUETA_ESTADO_PEDIDO } from '@/lib/admin/pedidos/etiquetas';
import {
  ESTADOS_RESENA,
  ETIQUETA_ESTADO_RESENA,
  ETIQUETA_FUENTE,
  leerFiltrosResena,
  parametrosDeFiltrosResena,
  resenaAfirmaOriginalidad,
} from '@/lib/admin/resenas/resenas';
import { contarResenas, listarResenas } from '@/lib/admin/resenas/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { destacarResena, moderarResena } from './acciones';

export const metadata: Metadata = { title: 'Reseñas' };

export default async function PaginaResenas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'resenas', accion: 'resenas.gestionar' });
  const sp = await searchParams;
  const filtros = leerFiltrosResena(sp);
  const parametros = parametrosDeFiltrosResena(filtros);
  const retorno = new URLSearchParams(parametros).toString();
  const cliente = crearClienteServicio();
  const [{ filas, total }, conteo] = await Promise.all([listarResenas(cliente, filtros), contarResenas(cliente, filtros.pais)]);
  const href = (extra: Record<string, string>) => `/admin/resenas?${new URLSearchParams({ ...parametros, ...extra }).toString()}`;

  return (
    <>
      <div className="adm-cabecera">
        <h1>Reseñas</h1>
        <Link href="/admin/resenas/nuevo" className="adm-enlace-boton">
          Escribir una reseña
        </Link>
      </div>
      <p className="adm-suave">
        Aprueba o rechaza lo que escriben los clientes, destaca las mejores en el home y agrega reseñas de Izao. Una reseña aprobada
        se publica en la ficha del producto (o en la tienda, si no tiene producto).
      </p>
      {sp.guardado ? <p className="adm-ok" role="status">Reseña guardada.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Reseña eliminada.</p> : null}
      {sp.error ? <p className="adm-alerta" role="alert">No se pudo completar el cambio. Recarga la página e inténtalo de nuevo.</p> : null}

      <ul className="adm-pestanas" aria-label="Estado">
        {ESTADOS_RESENA.map((e) => (
          <li key={e}>
            <Link href={href({ estado: e })} aria-current={filtros.estado === e ? 'page' : undefined}>
              {ETIQUETA_ESTADO_RESENA[e]} ({conteo[e]})
            </Link>
          </li>
        ))}
        <li>
          <Link href={href({ estado: 'todas' })} aria-current={filtros.estado === 'todas' ? 'page' : undefined}>
            Todas
          </Link>
        </li>
      </ul>

      <form className="adm-busqueda adm-filtros" method="get" action="/admin/resenas" aria-label="Filtros de reseñas">
        <input type="hidden" name="estado" value={filtros.estado} />
        <div className="adm-campo">
          <label htmlFor="r-pais" className="adm-etiqueta">
            País
          </label>
          <select id="r-pais" name="pais" className="adm-input" defaultValue={filtros.pais}>
            <option value="">Todos</option>
            <option value="CO">Colombia</option>
            <option value="EC">Ecuador</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="r-fuente" className="adm-etiqueta">
            Origen
          </label>
          <select id="r-fuente" name="fuente" className="adm-input" defaultValue={filtros.fuente}>
            <option value="">Todos</option>
            <option value="customer">Clientes</option>
            <option value="admin">Escritas por Izao</option>
          </select>
        </div>
        <label className="adm-check">
          <input type="checkbox" name="destacadas" value="1" defaultChecked={filtros.soloDestacadas} />
          Solo destacadas en el home
        </label>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">{filtros.estado === 'pending' ? 'No hay reseñas por revisar.' : 'Ninguna reseña coincide con esos filtros.'}</p>
      ) : (
        <ul className="adm-lista-simple">
          {filas.map((r) => (
            <li key={r.id} className="adm-tarjeta">
              <p>
                <strong>{'★'.repeat(r.rating)}</strong>
                <span className="adm-suave">{'☆'.repeat(5 - r.rating)}</span>{' '}
                <span className="adm-visualmente-oculto">{r.rating} de 5 estrellas. </span>
                {r.author_name}
                {r.city ? <span className="adm-suave"> · {r.city}</span> : null}{' '}
                <span className="adm-insignia">{ETIQUETA_ESTADO_RESENA[r.status]}</span>{' '}
                {r.featured_home ? <span className="adm-insignia adm-insignia-ok">En el home</span> : null}{' '}
                {r.is_verified_purchase ? <span className="adm-insignia">Compra verificada</span> : null}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.body ?? <span className="adm-suave">Sin texto</span>}</p>
              {resenaAfirmaOriginalidad(r) ? (
                <p className="adm-alerta" role="alert">
                  Este texto afirma originalidad o autenticidad: no la publiques tal cual (la tienda no puede garantizarlo).
                </p>
              ) : null}
              {r.fotos.length > 0 ? (
                <ul className="adm-lista-simple" aria-label="Fotos de la reseña">
                  {r.fotos.map((f) => (
                    <li key={f.id}>
                      <a href={`/media/${f.ruta}`} target="_blank" rel="noopener noreferrer">
                        <img className="adm-miniatura" src={`/media/${f.ruta}`} alt={f.alt} loading="lazy" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {r.order_id && r.orders ? (
                <p className="adm-chico">
                  Pedido:{' '}
                  <Link href={`/admin/pedidos/${r.order_id}`}>{r.orders.number}</Link>{' '}
                  <span className="adm-suave">({ETIQUETA_ESTADO_PEDIDO[r.orders.status] ?? r.orders.status})</span>
                </p>
              ) : r.source === 'customer' ? (
                <p className="adm-suave adm-chico">Sin pedido ligado: no se pudo verificar la compra.</p>
              ) : null}
              <p className="adm-suave adm-chico">
                {r.country_code} · {ETIQUETA_FUENTE[r.source]} · {r.products ? `Producto: ${r.products.name}` : 'Reseña de la tienda'} ·{' '}
                {fechaHoraBogota(r.created_at)}
              </p>
              <div className="adm-acciones">
                {r.status !== 'approved' ? (
                  <form action={moderarResena.bind(null, r.id, 'approved', retorno)}>
                    <button type="submit" className="adm-boton">
                      Aprobar
                    </button>
                  </form>
                ) : null}
                {r.status !== 'rejected' ? (
                  <form action={moderarResena.bind(null, r.id, 'rejected', retorno)}>
                    <button type="submit" className="adm-boton adm-boton-secundario">
                      Rechazar
                    </button>
                  </form>
                ) : null}
                {r.status === 'approved' ? (
                  <form action={destacarResena.bind(null, r.id, !r.featured_home, retorno)}>
                    <button type="submit" className="adm-boton adm-boton-secundario">
                      {r.featured_home ? 'Quitar del home' : 'Destacar en el home'}
                    </button>
                  </form>
                ) : null}
                <Link href={`/admin/resenas/${r.id}`} className="adm-enlace-boton adm-boton-secundario">
                  {r.source === 'admin' ? 'Editar' : 'Ver'}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Paginacion base="/admin/resenas" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
