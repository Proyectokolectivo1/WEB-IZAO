import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { leerFiltrosAuditoria, parametrosDeFiltrosAuditoria, resumenDiff } from '@/lib/admin/sistema/auditoria';
import { listarAuditoria } from '@/lib/admin/sistema/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Auditoría' };

export default async function PaginaAuditoria({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'sistema' });
  const filtros = leerFiltrosAuditoria(await searchParams);
  const parametros = parametrosDeFiltrosAuditoria(filtros);
  const { filas, total } = await listarAuditoria(crearClienteServicio(), filtros);

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/sistema">Sistema</Link> / Auditoría
      </p>
      <h1>Auditoría</h1>
      <p className="adm-suave">
        Todo cambio hecho desde el panel queda aquí con quién lo hizo y cuándo. Los ingresos al panel están ocultos salvo que los
        pidas. Las contraseñas y los datos personales nunca se guardan en este registro.
      </p>
      <form className="adm-busqueda adm-filtros" role="search" method="get" action="/admin/sistema/auditoria">
        <div className="adm-campo">
          <label htmlFor="a-accion" className="adm-etiqueta">
            Acción (empieza por)
          </label>
          <input id="a-accion" name="accion" className="adm-input" defaultValue={filtros.accion} placeholder="usuarios." maxLength={60} />
        </div>
        <div className="adm-campo">
          <label htmlFor="a-entidad" className="adm-etiqueta">
            Entidad
          </label>
          <input id="a-entidad" name="entidad" className="adm-input" defaultValue={filtros.entidad} placeholder="orders" maxLength={60} />
        </div>
        <div className="adm-campo">
          <label htmlFor="a-actor" className="adm-etiqueta">
            Actor (id)
          </label>
          <input id="a-actor" name="actor" className="adm-input" defaultValue={filtros.actor} maxLength={80} />
        </div>
        <div className="adm-campo">
          <label htmlFor="a-desde" className="adm-etiqueta">
            Desde
          </label>
          <input id="a-desde" name="desde" type="date" className="adm-input" defaultValue={filtros.desde} />
        </div>
        <div className="adm-campo">
          <label htmlFor="a-hasta" className="adm-etiqueta">
            Hasta
          </label>
          <input id="a-hasta" name="hasta" type="date" className="adm-input" defaultValue={filtros.hasta} />
        </div>
        <label className="adm-check">
          <input type="checkbox" name="accesos" value="1" defaultChecked={filtros.accesos} />
          Incluir ingresos al panel
        </label>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
        <Link className="adm-enlace-boton adm-boton-secundario" href="/admin/sistema/auditoria">
          Limpiar
        </Link>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">Ningún evento coincide con esos filtros.</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Eventos más recientes primero</caption>
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Quién</th>
                <th scope="col">Acción</th>
                <th scope="col">Sobre</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((e) => (
                <tr key={e.id}>
                  <td className="adm-suave">{fechaHoraBogota(e.created_at)}</td>
                  <td data-etiqueta="Quién">
                    {e.actorNombre ?? <code>{e.actor.slice(0, 24)}</code>}
                    {e.ip ? <span className="adm-suave adm-chico"> · {e.ip}</span> : null}
                  </td>
                  <td data-etiqueta="Acción">
                    <code>{e.action}</code>
                  </td>
                  <td data-etiqueta="Sobre" className="adm-suave">
                    {e.entity}
                    {e.entity_id ? ` · ${e.entity_id.slice(0, 12)}` : ''}
                  </td>
                  <td data-etiqueta="Detalle" className="adm-suave adm-chico" style={{ overflowWrap: 'anywhere' }}>
                    {resumenDiff(e.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/sistema/auditoria" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
