import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import { leerParametrosLista } from '@/lib/admin/crud/comun';
import { listarInfluencers } from '@/lib/admin/descuentos/influencers-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Influencers' };

export default async function ListaInfluencers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'influencers' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const { q, pagina } = leerParametrosLista(sp);
  const { filas, total, codigos } = await listarInfluencers(crearClienteServicio(), { pais, q, pagina });

  return (
    <>
      <div className="adm-cabecera">
        <h1>Influencers</h1>
        <div className="adm-acciones">
          <Link href={`/admin/influencers/reporte?pais=${pais}`} className="adm-enlace-boton adm-boton-secundario">
            Reporte de ventas
          </Link>
          <Link href={`/admin/influencers/nuevo?pais=${pais}`} className="adm-enlace-boton">
            Nuevo influencer
          </Link>
        </div>
      </div>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Influencer eliminado.</p> : null}
      <p className="adm-suave">
        Cada influencer tiene uno o varios códigos de descuento (se crean en <Link href="/admin/descuentos">Descuentos</Link>).
        Sus ventas se atribuyen por el código usado o por su enlace de referido.
      </p>
      <PestanasPais base="/admin/influencers" actual={pais} />
      <form className="adm-busqueda" role="search" method="get">
        <input type="hidden" name="pais" value={pais} />
        <div className="adm-campo">
          <label htmlFor="buscar-q" className="adm-etiqueta">
            Buscar por nombre
          </label>
          <input id="buscar-q" name="q" className="adm-input" defaultValue={q} maxLength={100} />
        </div>
        <button type="submit" className="adm-boton adm-boton-secundario">
          Buscar
        </button>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">
          {q ? 'No hay influencers con ese nombre.' : 'Aún no hay influencers para este país. '}
          {q ? null : <Link href={`/admin/influencers/nuevo?pais=${pais}`}>Crear el primero</Link>}
        </p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Influencers de {pais === 'CO' ? 'Colombia' : 'Ecuador'}</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Usuario</th>
                <th scope="col">Comisión</th>
                <th scope="col">Códigos</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/admin/influencers/${i.id}`}>{i.name}</Link>
                  </td>
                  <td data-etiqueta="Usuario" className="adm-suave">{i.handle ? `@${i.handle}` : '—'}</td>
                  <td data-etiqueta="Comisión">{i.commission_pct === null ? '—' : `${Number(i.commission_pct)} %`}</td>
                  <td data-etiqueta="Códigos">{(codigos.get(i.id) ?? []).map((c) => c.code).join(', ') || '—'}</td>
                  <td data-etiqueta="Estado">
                    <span className={`adm-insignia ${i.is_active ? 'adm-insignia-ok' : ''}`.trim()}>{i.is_active ? 'Activo' : 'Inactivo'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/influencers" total={total} pagina={pagina} parametros={{ pais, ...(q ? { q } : {}) }} />
    </>
  );
}
