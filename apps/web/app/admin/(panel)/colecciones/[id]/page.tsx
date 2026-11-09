import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonConfirmar } from '@/components/admin/BotonConfirmar';
import { BuscadorLista } from '@/components/admin/BuscadorLista';
import { FormularioColeccion } from '@/components/admin/FormularioColeccion';
import { leerPais } from '@/components/admin/PestanasPais';
import { descomponerRegla } from '@/lib/admin/catalogo/colecciones';
import { buscarProductos, obtenerColeccion } from '@/lib/admin/catalogo/colecciones-servidor';
import { listarCategorias } from '@/lib/admin/catalogo/categorias-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { agregarItem, eliminarColeccion, guardarColeccion, moverItem, quitarItem } from '../acciones';

export const metadata: Metadata = { title: 'Editar colección' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarColeccion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'colecciones' });
  const { id } = await params;
  const sp = await searchParams;
  const nueva = id === 'nueva';
  if (!nueva && !UUID.test(id)) notFound();

  const cliente = crearClienteServicio();
  const datos = nueva ? null : await obtenerColeccion(cliente, id);
  if (!nueva && !datos) notFound();
  const col = datos?.coleccion;
  const items = datos?.items ?? [];

  const q = (Array.isArray(sp.buscar) ? sp.buscar[0] : sp.buscar)?.trim().slice(0, 100) ?? '';
  const categorias = (await listarCategorias(cliente)).map((c) => ({ valor: c.id, etiqueta: c.name }));
  const enColeccion = new Set(items.map((i) => i.product_id));
  const resultados = col?.type === 'manual' && q ? (await buscarProductos(cliente, q)).filter((p) => !enColeccion.has(p.id)) : [];
  const regla = descomponerRegla(col?.rule);
  const error = typeof sp.error === 'string' ? sp.error : null;

  return (
    <>
      <p className="adm-migas">
        <Link href={`/admin/colecciones?pais=${col?.country_code ?? leerPais(sp.pais)}`}>Colecciones</Link> /{' '}
        {nueva ? 'Nueva' : col?.name}
      </p>
      <h1>{nueva ? 'Nueva colección' : 'Editar colección'}</h1>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {error ? <p className="adm-alerta" role="alert">{error}</p> : null}
      <FormularioColeccion
        categorias={categorias}
        accion={guardarColeccion}
        volverHref={`/admin/colecciones?pais=${col?.country_code ?? leerPais(sp.pais)}`}
        inicial={{
          ...(col ? { id: col.id } : {}),
          country_code: col?.country_code ?? leerPais(sp.pais),
          name: col?.name ?? '',
          slug: col?.slug ?? '',
          type: col?.type ?? 'manual',
          regla_tipo: regla.tipo,
          regla_valor: regla.valor,
          sort_order: col?.sort_order ?? 0,
          show_in_home_tabs: col?.show_in_home_tabs ?? false,
          is_active: col?.is_active ?? true,
        }}
      />

      {col?.type === 'manual' ? (
        <section className="adm-pila" aria-labelledby="titulo-productos">
          <h2 id="titulo-productos">Productos de la colección</h2>
          {items.length === 0 ? (
            <p className="adm-vacio">Aún no hay productos. Busca uno abajo para agregarlo.</p>
          ) : (
            <div className="adm-tabla-caja">
              <table className="adm-tabla adm-tabla-apilada">
                <caption className="adm-suave">En el orden en que se muestran</caption>
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, n) => (
                    <tr key={i.product_id}>
                      <td>{i.name}</td>
                      <td data-etiqueta="Estado" className="adm-suave">{i.status === 'active' ? 'Activo' : i.status === 'draft' ? 'Borrador' : 'Archivado'}</td>
                      <td data-etiqueta="Acciones">
                        <div className="adm-acciones">
                          <form action={moverItem.bind(null, col.id, i.product_id, 'arriba')}>
                            <button type="submit" className="adm-boton adm-boton-secundario" disabled={n === 0} aria-label={`Subir ${i.name}`}>
                              Subir
                            </button>
                          </form>
                          <form action={moverItem.bind(null, col.id, i.product_id, 'abajo')}>
                            <button type="submit" className="adm-boton adm-boton-secundario" disabled={n === items.length - 1} aria-label={`Bajar ${i.name}`}>
                              Bajar
                            </button>
                          </form>
                          <form action={quitarItem.bind(null, col.id, i.product_id)}>
                            <button type="submit" className="adm-boton adm-boton-secundario" aria-label={`Quitar ${i.name}`}>
                              Quitar
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <BuscadorLista parametro="buscar" q={q} etiqueta="Buscar producto para agregar" limpiarHref={`/admin/colecciones/${col.id}`} ocultos={{}} />
          {q && resultados.length === 0 ? <p className="adm-suave">No hay productos nuevos con ese nombre.</p> : null}
          {resultados.length > 0 ? (
            <ul className="adm-pila" style={{ listStyle: 'none', padding: 0 }}>
              {resultados.map((p) => (
                <li key={p.id} className="adm-acciones">
                  <span>{p.name}</span>
                  <form action={agregarItem.bind(null, col.id, p.id)}>
                    <button type="submit" className="adm-boton" aria-label={`Agregar ${p.name}`}>
                      Agregar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {col ? (
        <section className="adm-form-ancho" aria-label="Zona de eliminación">
          <BotonConfirmar
            etiqueta="Eliminar colección"
            mensaje={`Vas a eliminar "${col.name}". Los productos no se borran, solo dejan de estar agrupados.`}
            etiquetaConfirmar="Sí, eliminar"
            accion={eliminarColeccion.bind(null, col.id)}
          />
        </section>
      ) : null}
    </>
  );
}
