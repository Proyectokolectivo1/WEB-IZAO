import type { Metadata } from 'next';
import Link from 'next/link';
import { BuscadorLista } from '@/components/admin/BuscadorLista';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { NOMBRE_PAIS } from '@/lib/admin/catalogo/categorias';
import { buscarProductos, listarDestacados } from '@/lib/admin/catalogo/colecciones-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { destacar, moverDestacado, quitarDestacado } from '../acciones';

export const metadata: Metadata = { title: 'Productos destacados' };

export default async function Destacados({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'colecciones' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const cliente = crearClienteServicio();
  const destacados = await listarDestacados(cliente, pais);
  const q = (Array.isArray(sp.buscar) ? sp.buscar[0] : sp.buscar)?.trim().slice(0, 100) ?? '';
  const ya = new Set(destacados.map((d) => d.product_id));
  const resultados = q ? (await buscarProductos(cliente, q)).filter((p) => !ya.has(p.id)) : [];
  const error = typeof sp.error === 'string' ? sp.error : null;
  const base = '/admin/colecciones/destacados';

  return (
    <>
      <p className="adm-migas">
        <Link href={`/admin/colecciones?pais=${pais}`}>Colecciones</Link> / Destacados
      </p>
      <h1>Productos destacados</h1>
      <p className="adm-suave">
        Los destacados salen primero en el orden «Destacados» del catálogo de {NOMBRE_PAIS[pais]}, siempre que tengan stock.
      </p>
      <PestanasPais base={base} actual={pais} />
      {error ? <p className="adm-alerta" role="alert">{error}</p> : null}
      {destacados.length === 0 ? (
        <p className="adm-vacio">Aún no hay destacados en {NOMBRE_PAIS[pais]}. Busca un producto abajo para destacarlo.</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Destacados de {NOMBRE_PAIS[pais]}, de primero a último</caption>
            <thead>
              <tr>
                <th scope="col" className="adm-num">#</th>
                <th scope="col">Producto</th>
                <th scope="col">En la tienda</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {destacados.map((d, n) => (
                <tr key={d.product_id}>
                  <td className="adm-num">{n + 1}</td>
                  <td data-etiqueta="Producto">{d.name}</td>
                  <td data-etiqueta="En la tienda">
                    {d.is_visible ? (
                      <span className="adm-insignia adm-insignia-ok">Visible</span>
                    ) : (
                      <span className="adm-insignia adm-insignia-aviso">Oculto</span>
                    )}
                  </td>
                  <td data-etiqueta="Acciones">
                    <div className="adm-acciones">
                      <form action={moverDestacado.bind(null, pais, d.product_id, 'arriba')}>
                        <button type="submit" className="adm-boton adm-boton-secundario" disabled={n === 0} aria-label={`Subir ${d.name}`}>
                          Subir
                        </button>
                      </form>
                      <form action={moverDestacado.bind(null, pais, d.product_id, 'abajo')}>
                        <button type="submit" className="adm-boton adm-boton-secundario" disabled={n === destacados.length - 1} aria-label={`Bajar ${d.name}`}>
                          Bajar
                        </button>
                      </form>
                      <form action={quitarDestacado.bind(null, pais, d.product_id)}>
                        <button type="submit" className="adm-boton adm-boton-secundario" aria-label={`Quitar ${d.name} de destacados`}>
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
      <BuscadorLista parametro="buscar" q={q} etiqueta="Buscar producto para destacar" limpiarHref={`${base}?pais=${pais}`} ocultos={{ pais }} />
      {q && resultados.length === 0 ? <p className="adm-suave">No hay productos nuevos con ese nombre.</p> : null}
      {resultados.length > 0 ? (
        <ul className="adm-pila" style={{ listStyle: 'none', padding: 0 }}>
          {resultados.map((p) => (
            <li key={p.id} className="adm-acciones">
              <span>{p.name}</span>
              <form action={destacar.bind(null, pais, p.id)}>
                <button type="submit" className="adm-boton" aria-label={`Destacar ${p.name}`}>
                  Destacar
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
