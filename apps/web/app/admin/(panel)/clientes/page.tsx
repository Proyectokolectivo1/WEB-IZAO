import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { leerFiltrosCliente, nombreDeCliente, parametrosDeFiltrosCliente } from '@/lib/admin/clientes/clientes';
import { listarClientes } from '@/lib/admin/clientes/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Clientes' };

const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'clientes', accion: 'clientes.gestionar' });
  const filtros = leerFiltrosCliente(await searchParams);
  const parametros = parametrosDeFiltrosCliente(filtros);
  const { filas, total } = await listarClientes(crearClienteServicio(), filtros);

  return (
    <>
      <h1>Clientes</h1>
      <p className="adm-suave">
        Personas que han comprado o creado una cuenta. Aquí se atienden también las solicitudes de supresión de datos
        (habeas data): el detalle del cliente permite anonimizarlo.
      </p>
      <form className="adm-busqueda adm-filtros" role="search" method="get" action="/admin/clientes">
        <div className="adm-campo">
          <label htmlFor="c-q" className="adm-etiqueta">
            Nombre, correo, celular o documento
          </label>
          <input id="c-q" name="q" className="adm-input" defaultValue={filtros.q} maxLength={100} />
        </div>
        <div className="adm-campo">
          <label htmlFor="c-pais" className="adm-etiqueta">
            País
          </label>
          <select id="c-pais" name="pais" className="adm-input" defaultValue={filtros.pais}>
            <option value="">Todos</option>
            <option value="CO">Colombia</option>
            <option value="EC">Ecuador</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="c-estado" className="adm-etiqueta">
            Estado
          </label>
          <select id="c-estado" name="estado" className="adm-input" defaultValue={filtros.estado}>
            <option value="">Todos</option>
            <option value="activos">Activos</option>
            <option value="anonimizados">Anonimizados</option>
          </select>
        </div>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
        <Link className="adm-enlace-boton adm-boton-secundario" href="/admin/clientes">
          Limpiar
        </Link>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">{Object.keys(parametros).length > 0 ? 'Ningún cliente coincide con esos filtros.' : 'Aún no hay clientes.'}</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Clientes más recientes primero</caption>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">País</th>
                <th scope="col">Correo</th>
                <th scope="col">Celular</th>
                <th scope="col">Desde</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/clientes/${c.id}`}>{nombreDeCliente(c)}</Link>
                    {c.anonymized_at ? <span className="adm-insignia"> Anonimizado</span> : null}
                  </td>
                  <td data-etiqueta="País">{c.country_code}</td>
                  <td data-etiqueta="Correo" className="adm-suave">{c.email ?? '—'}</td>
                  <td data-etiqueta="Celular" className="adm-suave">{c.phone_e164 ?? '—'}</td>
                  <td data-etiqueta="Desde" className="adm-suave">{fecha.format(new Date(c.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/clientes" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
