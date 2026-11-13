import { COUNTRY_CURRENCY, formatMoney, money } from '@izao/core/money';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { Paginacion } from '@/components/admin/Paginacion';
import { NOMBRE_PAIS } from '@/lib/admin/catalogo/categorias';
import {
  ESTADOS_PRODUCTO,
  ETIQUETA_ESTADO,
  MENSAJE_ELIMINAR,
  PAISES_PRODUCTO,
  leerFiltrosProductos,
  parametrosFiltros,
} from '@/lib/admin/catalogo/productos';
import { listarProductos, opcionesFormulario } from '@/lib/admin/catalogo/productos-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/permissions';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { eliminarProductoAccion, restaurarProductoAccion } from './acciones';

export const metadata: Metadata = { title: 'Productos' };

export default async function ListaProductos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requerirAdmin({ modulo: 'productos' });
  const puedeGestionar = puede(admin.rol, 'catalogo.gestionar');
  const sp = await searchParams;
  const filtros = leerFiltrosProductos(sp);
  const cliente = crearClienteServicio();
  const [{ filas, total }, opciones] = await Promise.all([listarProductos(cliente, filtros), opcionesFormulario(cliente)]);
  const hayFiltros = Boolean(filtros.q || filtros.estado || filtros.marca || filtros.pais);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Productos</h1>
        <div className="adm-acciones">
          <Link href="/admin/productos/importar" className="adm-enlace-boton adm-boton-secundario">
            Importar y exportar
          </Link>
          <Link href="/admin/productos/nuevo" className="adm-enlace-boton">
            Nuevo producto
          </Link>
        </div>
      </div>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.archivado ? <p className="adm-ok" role="status">Producto archivado.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Producto eliminado.</p> : null}
      {sp.conservado ? (
        <p className="adm-ok" role="status">
          El producto tiene pedidos, así que no se borró: quedó archivado y ya no se muestra en la tienda. Su historial se conserva y lo
          encuentras con el filtro «Archivados».
        </p>
      ) : null}

      <form className="adm-filtros" role="search" method="get">
        <div className="adm-campo">
          <label htmlFor="buscar-q" className="adm-etiqueta">
            Buscar por nombre, URL o SKU
          </label>
          <input id="buscar-q" name="q" type="search" className="adm-input" defaultValue={filtros.q} maxLength={100} />
        </div>
        <div className="adm-campo">
          <label htmlFor="f-estado" className="adm-etiqueta">
            Estado
          </label>
          <select id="f-estado" name="estado" className="adm-input" defaultValue={filtros.estado}>
            <option value="">Todos (sin archivados)</option>
            {ESTADOS_PRODUCTO.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="f-marca" className="adm-etiqueta">
            Marca
          </label>
          <select id="f-marca" name="marca" className="adm-input" defaultValue={filtros.marca}>
            <option value="">Todas</option>
            {opciones.marcas.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="f-pais" className="adm-etiqueta">
            Visible en
          </label>
          <select id="f-pais" name="pais" className="adm-input" defaultValue={filtros.pais}>
            <option value="">Cualquier país</option>
            {PAISES_PRODUCTO.map((p) => (
              <option key={p} value={p}>
                {NOMBRE_PAIS[p]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
        {hayFiltros ? (
          <Link className="adm-enlace-boton adm-boton-secundario" href="/admin/productos">
            Limpiar
          </Link>
        ) : null}
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">
          {hayFiltros ? 'Ningún producto coincide con los filtros.' : 'Aún no hay productos.'}{' '}
          <Link href="/admin/productos/nuevo">Crear el primero</Link>
        </p>
      ) : (
        <>
          <div className="adm-tabla-caja">
            <table className="adm-tabla adm-tabla-prod adm-tabla-apilada">
              <caption className="adm-suave">Productos, del modificado más recientemente al más antiguo</caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Variantes</th>
                  {PAISES_PRODUCTO.map((p) => (
                    <th key={p} scope="col">
                      {NOMBRE_PAIS[p]}
                    </th>
                  ))}
                  {puedeGestionar ? <th scope="col">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div className="adm-prod-celda">
                        {f.imagen ? (
                          <img className="adm-prod-miniatura" src={`/media/${f.imagen}`} alt="" />
                        ) : (
                          <span className="adm-prod-miniatura" aria-hidden="true" />
                        )}
                        <div>
                          <Link href={`/admin/productos/${f.id}`}>{f.name}</Link>
                          <div className="adm-suave adm-chico">{f.marca ?? 'Sin marca'}</div>
                        </div>
                      </div>
                    </td>
                    <td data-etiqueta="Estado">
                      <span
                        className={`adm-insignia ${f.status === 'active' ? 'adm-insignia-ok' : f.status === 'draft' ? 'adm-insignia-aviso' : ''}`.trim()}
                      >
                        {ETIQUETA_ESTADO[f.status]}
                      </span>
                    </td>
                    <td data-etiqueta="Variantes">{f.variantes}</td>
                    {PAISES_PRODUCTO.map((p) => {
                      const r = f.paises[p];
                      return (
                        <td key={p} data-etiqueta={NOMBRE_PAIS[p]}>
                          <div className="adm-celda-pais">
                          <span className={`adm-insignia ${r.visible ? 'adm-insignia-ok' : ''}`.trim()}>
                            {r.visible ? 'Visible' : 'Oculto'}
                          </span>
                          <div className="adm-chico">
                            {r.precioDesde === null ? (
                              <span className="adm-suave">Sin precio</span>
                            ) : (
                              <>desde {formatMoney(money(r.precioDesde, COUNTRY_CURRENCY[p]))}</>
                            )}
                          </div>
                          <div className="adm-suave adm-chico">Stock {r.stock}</div>
                          </div>
                        </td>
                      );
                    })}
                    {puedeGestionar ? (
                      <td data-etiqueta="Acciones">
                        <div className="adm-acciones">
                          {f.status === 'archived' ? (
                            <BotonConfirmar
                              etiqueta="Restaurar"
                              mensaje={`«${f.name}» vuelve como borrador, oculto en todos los países. Revísalo y publícalo cuando esté listo.`}
                              etiquetaConfirmar="Sí, restaurar"
                              peligro={false}
                              accion={restaurarProductoAccion.bind(null, f.id)}
                            />
                          ) : null}
                          <BotonConfirmar
                            etiqueta="Eliminar"
                            mensaje={MENSAJE_ELIMINAR(f.name)}
                            etiquetaConfirmar="Sí, eliminar"
                            accion={eliminarProductoAccion.bind(null, f.id)}
                          />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion base="/admin/productos" total={total} pagina={filtros.pagina} parametros={parametrosFiltros(filtros)} />
        </>
      )}
    </>
  );
}
