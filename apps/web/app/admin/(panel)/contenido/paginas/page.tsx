import type { Metadata } from 'next';
import Link from 'next/link';
import { PestanasPais, leerPais } from '@/components/admin/PestanasPais';
import {
  ESTADOS_PAGINA,
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  TIPOS_PAGINA,
  type EstadoPagina,
  type TipoPagina,
} from '@/lib/admin/contenido/paginas';
import { listarPaginas } from '@/lib/admin/contenido/paginas-servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Páginas y políticas' };

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

export default async function ListaPaginas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'contenido' });
  const sp = await searchParams;
  const pais = leerPais(sp.pais);
  const estado = ESTADOS_PAGINA.find((e) => e === un(sp.estado));
  const tipo = TIPOS_PAGINA.find((t) => t === un(sp.tipo));
  const filas = await listarPaginas(crearClienteServicio(), { pais, estado, tipo });

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/contenido">Contenido</Link> / Páginas y políticas
      </p>
      <div className="adm-cabecera">
        <h1>Páginas y políticas</h1>
        <Link href={`/admin/contenido/paginas/nueva?pais=${pais}`} className="adm-enlace-boton">
          Nueva página
        </Link>
      </div>
      {sp.guardado ? (
        <p className="adm-ok" role="status">
          Cambios guardados.
          {un(sp.despublicada)
            ? ` Pasó a borrador la página que estaba publicada en su lugar: "${un(sp.despublicada)}".`
            : ''}
        </p>
      ) : null}
      {sp.eliminado ? (
        <p className="adm-ok" role="status">
          Página eliminada.
        </p>
      ) : null}
      <PestanasPais base="/admin/contenido/paginas" actual={pais} />
      <form method="get" className="adm-fila" role="search" aria-label="Filtrar páginas">
        <input type="hidden" name="pais" value={pais} />
        <div className="adm-campo">
          <label htmlFor="f-estado" className="adm-etiqueta">
            Estado
          </label>
          <select id="f-estado" name="estado" className="adm-input" defaultValue={estado ?? ''}>
            <option value="">Todos</option>
            {ESTADOS_PAGINA.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="f-tipo" className="adm-etiqueta">
            Tipo
          </label>
          <select id="f-tipo" name="tipo" className="adm-input" defaultValue={tipo ?? ''}>
            <option value="">Todos</option>
            {TIPOS_PAGINA.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO[t]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="adm-boton adm-boton-secundario">
          Filtrar
        </button>
      </form>
      {filas.length === 0 ? (
        <p className="adm-vacio">No hay páginas con estos filtros.</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-suave">Páginas del país elegido</caption>
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Tipo</th>
                <th scope="col">URL</th>
                <th scope="col">Estado</th>
                <th scope="col">Versión</th>
                <th scope="col">Actualizada</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`/admin/contenido/paginas/${f.id}`}>{f.title}</Link>
                  </td>
                  <td>{ETIQUETA_TIPO[f.kind as TipoPagina] ?? f.kind}</td>
                  <td className="adm-suave">{f.slug}</td>
                  <td>
                    <span className={f.status === 'published' ? 'adm-insignia adm-insignia-ok' : 'adm-insignia'}>
                      {ETIQUETA_ESTADO[f.status as EstadoPagina] ?? f.status}
                    </span>
                  </td>
                  <td>{f.version}</td>
                  <td className="adm-suave">{fecha.format(new Date(f.updated_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
