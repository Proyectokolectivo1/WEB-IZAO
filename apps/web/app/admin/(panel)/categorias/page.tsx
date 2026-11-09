import type { Metadata } from 'next';
import Link from 'next/link';
import { NOMBRE_PAIS, PAISES_CATALOGO, ordenarArbol } from '@/lib/admin/catalogo/categorias';
import { listarCategorias } from '@/lib/admin/catalogo/categorias-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Categorías' };

export default async function ListaCategorias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'categorias' });
  const sp = await searchParams;
  const filas = ordenarArbol(await listarCategorias(crearClienteServicio()));

  return (
    <>
      <div className="adm-cabecera">
        <h1>Categorías</h1>
        <Link href="/admin/categorias/nueva" className="adm-enlace-boton">
          Nueva categoría
        </Link>
      </div>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Categoría eliminada.</p> : null}
      {filas.length === 0 ? (
        <p className="adm-vacio">
          Aún no hay categorías. <Link href="/admin/categorias/nueva">Crear la primera</Link>
        </p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Categorías (máximo 2 niveles)</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">URL</th>
                {PAISES_CATALOGO.map((p) => (
                  <th key={p} scope="col">
                    {NOMBRE_PAIS[p]}
                  </th>
                ))}
                <th scope="col">Menú</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td style={{ paddingLeft: f.nivel ? '2.25rem' : undefined }}>
                    <Link href={`/admin/categorias/${f.id}`}>{f.name}</Link>
                  </td>
                  <td data-etiqueta="URL" className="adm-suave">{f.slug}</td>
                  {PAISES_CATALOGO.map((p) => (
                    <td key={p} data-etiqueta={NOMBRE_PAIS[p]}>
                      {f.paises[p]?.is_visible ? (
                        <span className="adm-insignia adm-insignia-ok">Visible</span>
                      ) : (
                        <span className="adm-insignia">Oculta</span>
                      )}
                    </td>
                  ))}
                  <td data-etiqueta="Menú">{f.show_in_menu ? 'Sí' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
