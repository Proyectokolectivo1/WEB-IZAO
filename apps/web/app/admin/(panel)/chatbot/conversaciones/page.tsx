import type { Metadata } from 'next';
import Link from 'next/link';
import { Paginacion } from '@/components/admin/Paginacion';
import { leerFiltrosConversacion, parametrosDeFiltrosConversacion } from '@/lib/admin/chatbot/chatbot';
import { listarSesiones } from '@/lib/admin/chatbot/servidor';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Conversaciones de Iza' };

export default async function PaginaConversaciones({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'chatbot', accion: 'chatbot.gestionar' });
  const filtros = leerFiltrosConversacion(await searchParams);
  const parametros = parametrosDeFiltrosConversacion(filtros);
  const { filas, total } = await listarSesiones(crearClienteServicio(), filtros);

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/chatbot">Chatbot</Link> / Conversaciones
      </p>
      <h1>Conversaciones de Iza</h1>
      <p className="adm-suave">
        Lo que escriben los visitantes puede incluir datos personales: úsalo solo para mejorar la atención. Las conversaciones se
        borran solas a los 180 días.
      </p>
      <form className="adm-busqueda adm-filtros" role="search" method="get" action="/admin/chatbot/conversaciones">
        <div className="adm-campo">
          <label htmlFor="v-q" className="adm-etiqueta">
            Buscar en los mensajes (mínimo 3 letras)
          </label>
          <input id="v-q" name="q" className="adm-input" defaultValue={filtros.q} maxLength={80} />
        </div>
        <div className="adm-campo">
          <label htmlFor="v-pais" className="adm-etiqueta">
            País
          </label>
          <select id="v-pais" name="pais" className="adm-input" defaultValue={filtros.pais}>
            <option value="">Todos</option>
            <option value="CO">Colombia</option>
            <option value="EC">Ecuador</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="v-conv" className="adm-etiqueta">
            Terminó en pedido
          </label>
          <select id="v-conv" name="convertida" className="adm-input" defaultValue={filtros.convertida}>
            <option value="">Todas</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="adm-campo">
          <label htmlFor="v-desde" className="adm-etiqueta">
            Desde
          </label>
          <input id="v-desde" name="desde" type="date" className="adm-input" defaultValue={filtros.desde} />
        </div>
        <div className="adm-campo">
          <label htmlFor="v-hasta" className="adm-etiqueta">
            Hasta
          </label>
          <input id="v-hasta" name="hasta" type="date" className="adm-input" defaultValue={filtros.hasta} />
        </div>
        <button type="submit" className="adm-boton">
          Filtrar
        </button>
        <Link className="adm-enlace-boton adm-boton-secundario" href="/admin/chatbot/conversaciones">
          Limpiar
        </Link>
      </form>

      {filas.length === 0 ? (
        <p className="adm-vacio">{Object.keys(parametros).length > 0 ? 'Ninguna conversación coincide con esos filtros.' : 'Aún no hay conversaciones.'}</p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Conversaciones más recientes primero</caption>
            <thead>
              <tr>
                <th scope="col">Inicio</th>
                <th scope="col">País</th>
                <th scope="col">Mensajes</th>
                <th scope="col">Cliente</th>
                <th scope="col">Pedido</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/admin/chatbot/conversaciones/${s.id}`}>{fechaHoraBogota(s.started_at)}</Link>
                  </td>
                  <td data-etiqueta="País">{s.country_code}</td>
                  <td data-etiqueta="Mensajes">{s.messages_count}</td>
                  <td data-etiqueta="Cliente" className="adm-suave">{s.customer_id ? <Link href={`/admin/clientes/${s.customer_id}`}>Con cuenta</Link> : 'Visitante'}</td>
                  <td data-etiqueta="Pedido">{s.converted_order_id ? <Link href={`/admin/pedidos/${s.converted_order_id}`}>Ver pedido</Link> : <span className="adm-suave">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginacion base="/admin/chatbot/conversaciones" total={total} pagina={filtros.pagina} parametros={parametros} />
    </>
  );
}
