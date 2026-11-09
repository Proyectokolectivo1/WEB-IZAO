import type { Metadata } from 'next';
import Link from 'next/link';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { NOMBRE_PAIS } from '@/lib/admin/catalogo/categorias';
import { descomponerRegla, ETIQUETA_REGLA } from '@/lib/admin/catalogo/colecciones';
import { listarColecciones } from '@/lib/admin/catalogo/colecciones-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Colecciones' };

export default async function ListaColecciones({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'colecciones' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const filas = await listarColecciones(crearClienteServicio(), pais);

  return (
    <>
      <div className="adm-cabecera">
        <h1>Colecciones</h1>
        <div className="adm-acciones">
          <Link href={`/admin/colecciones/destacados?pais=${pais}`} className="adm-enlace-boton adm-boton-secundario">
            Destacados
          </Link>
          <Link href={`/admin/colecciones/nueva?pais=${pais}`} className="adm-enlace-boton">
            Nueva colección
          </Link>
        </div>
      </div>
      <PestanasPais base="/admin/colecciones" actual={pais} />
      {sp.eliminado ? <p className="adm-ok" role="status">Colección eliminada.</p> : null}
      {filas.length === 0 ? (
        <p className="adm-vacio">
          Aún no hay colecciones para {NOMBRE_PAIS[pais]}.{' '}
          <Link href={`/admin/colecciones/nueva?pais=${pais}`}>Crear la primera</Link>
        </p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Colecciones de {NOMBRE_PAIS[pais]}</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Tipo</th>
                <th scope="col">Inicio</th>
                <th scope="col">Estado</th>
                <th scope="col" className="adm-num">Orden</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const regla = descomponerRegla(f.rule);
                return (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/admin/colecciones/${f.id}`}>{f.name}</Link>
                    </td>
                    <td data-etiqueta="Tipo" className="adm-suave">
                      {f.type === 'manual' ? 'Manual' : regla.tipo ? ETIQUETA_REGLA[regla.tipo] : 'Por regla'}
                    </td>
                    <td data-etiqueta="Inicio">{f.show_in_home_tabs ? 'Pestaña' : '—'}</td>
                    <td data-etiqueta="Estado">
                      {f.is_active ? (
                        <span className="adm-insignia adm-insignia-ok">Activa</span>
                      ) : (
                        <span className="adm-insignia">Inactiva</span>
                      )}
                    </td>
                    <td data-etiqueta="Orden" className="adm-num">{f.sort_order}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
