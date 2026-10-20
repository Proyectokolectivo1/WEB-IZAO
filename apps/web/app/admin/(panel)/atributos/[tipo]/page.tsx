import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BuscadorLista } from '@/components/admin/BuscadorLista';
import { Paginacion } from '@/components/admin/Paginacion';
import { TAXONOMIAS, TIPOS_TAXONOMIA, esTipoTaxonomia } from '@/lib/admin/catalogo/taxonomias';
import { listarTaxonomia } from '@/lib/admin/catalogo/taxonomias-servidor';
import { leerParametrosLista } from '@/lib/admin/crud/comun';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Marcas y atributos' };

export default async function ListaAtributos({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'catalogo_auxiliar' });
  const { tipo } = await params;
  if (!esTipoTaxonomia(tipo)) notFound();
  const def = TAXONOMIAS[tipo];
  const sp = await searchParams;
  const lista = leerParametrosLista(sp);
  const { filas, total } = await listarTaxonomia(crearClienteServicio(), def, lista);
  const base = `/admin/atributos/${tipo}`;

  return (
    <>
      <div className="adm-cabecera">
        <h1>Marcas y atributos</h1>
        <Link href={`${base}/nuevo`} className="adm-enlace-boton">
          Nueva {def.singular}
        </Link>
      </div>
      <ul className="adm-pestanas" aria-label="Tipo de atributo">
        {TIPOS_TAXONOMIA.map((t) => (
          <li key={t}>
            <Link href={`/admin/atributos/${t}`} aria-current={t === tipo ? 'page' : undefined}>
              {TAXONOMIAS[t].plural}
            </Link>
          </li>
        ))}
      </ul>
      {sp.guardado ? <p className="adm-ok" role="status">Cambios guardados.</p> : null}
      {sp.eliminado ? <p className="adm-ok" role="status">Eliminada correctamente.</p> : null}
      <BuscadorLista q={lista.q} etiqueta={`Buscar en ${def.plural.toLowerCase()}`} limpiarHref={base} />
      {filas.length === 0 ? (
        <p className="adm-vacio">
          {lista.q
            ? 'Ningún resultado para esa búsqueda.'
            : `Aún no hay ${def.plural.toLowerCase()}. `}
          {lista.q ? null : <Link href={`${base}/nuevo`}>Crear la primera</Link>}
        </p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla">
            <caption className="adm-suave">{def.plural}</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">URL</th>
                {def.tieneOrden ? <th scope="col" className="adm-num">Orden</th> : null}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`${base}/${f.id}`}>{f.name}</Link>
                  </td>
                  <td className="adm-suave">{f.slug}</td>
                  {def.tieneOrden ? <td className="adm-num">{f.sort_order}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base={base} total={total} pagina={lista.pagina} parametros={lista.q ? { q: lista.q } : {}} />
    </>
  );
}
