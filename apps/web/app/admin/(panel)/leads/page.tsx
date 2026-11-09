import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { fuenteDeLead, leerFiltrosLead, parametrosDeFiltrosLead } from '@/lib/admin/leads/leads';
import { listarLeads, popupsParaFiltro } from '@/lib/admin/leads/servidor';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Leads' };

export default async function PaginaLeads({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'leads', accion: 'leads.gestionar' });
  const filtros = leerFiltrosLead(await searchParams);
  const parametros = parametrosDeFiltrosLead(filtros);
  const cliente = crearClienteServicio();
  const [{ filas, total }, popups] = await Promise.all([listarLeads(cliente, filtros), popupsParaFiltro(cliente)]);
  const descarga = new URLSearchParams(parametros).toString();

  return (
    <>
      <div className="adm-cabecera">
        <h1>Leads</h1>
        <a className="adm-enlace-boton adm-boton-secundario" href={`/api/admin/leads/exportar?${descarga}`}>
          Exportar a Excel
        </a>
      </div>
      <p className="adm-suave">
        Personas que dejaron su correo o celular en un pop-up. Son datos personales: úsalos solo según el consentimiento que
        dieron (columna «Acepta mercadeo»). Cada exportación queda en la auditoría.
      </p>
      <form className="adm-busqueda adm-filtros" role="search" method="get" action="/admin/leads">
        <div className="adm-campo">
          <label htmlFor="l-q" className="adm-etiqueta">
            Correo o celular
          </label>
          <input id="l-q" name="q" className="adm-input" defaultValue={filtros.q} maxLength={100} />
        </div>
        <div className="adm-campo">
          <label htmlFor="l-pais" className="adm-etiqueta">
            País
          </label>
          <select id="l-pais" name="pais" className="adm-input" defaultValue={filtros.pais}>
            <option value="">Todos</option>
            <option value="CO">Colombia</option>
            <option value="EC">Ecuador</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="l-popup" className="adm-etiqueta">
            Pop-up de origen
          </label>
          <select id="l-popup" name="popup" className="adm-input" defaultValue={filtros.popup}>
            <option value="">Todos</option>
            {popups.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.country_code})
              </option>
            ))}
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="l-conv" className="adm-etiqueta">
            Compró
          </label>
          <select id="l-conv" name="convertido" className="adm-input" defaultValue={filtros.convertido}>
            <option value="">Todos</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="l-optin" className="adm-etiqueta">
            Acepta mercadeo
          </label>
          <select id="l-optin" name="optin" className="adm-input" defaultValue={filtros.optin}>
            <option value="">Todos</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="l-desde" className="adm-etiqueta">
            Desde
          </label>
          <input id="l-desde" name="desde" type="date" className="adm-input" defaultValue={filtros.desde} />
        </div>
        <div className="adm-campo">
          <label htmlFor="l-hasta" className="adm-etiqueta">
            Hasta
          </label>
          <input id="l-hasta" name="hasta" type="date" className="adm-input" defaultValue={filtros.hasta} />
        </div>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
        <Link className="adm-enlace-boton adm-boton-secundario" href="/admin/leads">
          Limpiar
        </Link>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">{Object.keys(parametros).length > 0 ? 'Ningún lead coincide con esos filtros.' : 'Aún no hay leads.'}</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Leads más recientes primero</caption>
            <thead>
              <tr>
                <th scope="col">Contacto</th>
                <th scope="col">País</th>
                <th scope="col">Pop-up</th>
                <th scope="col">Código</th>
                <th scope="col">Mercadeo</th>
                <th scope="col">Compró</th>
                <th scope="col">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.email ?? '—'}
                    {l.phone_e164 ? <span className="adm-suave adm-chico"> · {l.phone_e164}</span> : null}
                    {fuenteDeLead(l.utm) ? <span className="adm-suave adm-chico"> · {fuenteDeLead(l.utm)}</span> : null}
                  </td>
                  <td data-etiqueta="País">{l.country_code}</td>
                  <td data-etiqueta="Pop-up" className="adm-suave">{l.popups?.name ?? '—'}</td>
                  <td data-etiqueta="Código" className="adm-suave">{l.discount_codes?.code ?? '—'}</td>
                  <td data-etiqueta="Mercadeo">{l.marketing_opt_in ? 'Sí' : 'No'}</td>
                  <td data-etiqueta="Compró">
                    {l.converted_order_id ? <Link href={`/admin/pedidos/${l.converted_order_id}`}>Ver pedido</Link> : <span className="adm-suave">No</span>}
                  </td>
                  <td data-etiqueta="Fecha" className="adm-suave">{fechaHoraBogota(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/leads" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
