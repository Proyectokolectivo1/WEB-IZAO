import type { Metadata } from 'next';
import Link from 'next/link';
import { AccionSimple } from '@/components/admin/AccionesPedido';
import { NuevoAgente } from '@/components/admin/GestionAgentes';
import { ETIQUETA_CONEXION } from '@/lib/admin/agentes/estado';
import { conEstado, listarAgentes, listarCola } from '@/lib/admin/agentes/servidor';
import { ETIQUETA_IMPRESION, ETIQUETA_TIPO_IMPRESION } from '@/lib/admin/pedidos/etiquetas';
import { requerirAdmin } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/permissions';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { crearAgente, imprimirPaginaPrueba, reimprimirDesdeAgente } from './acciones';

export const metadata: Metadata = { title: 'Agente de impresión' };

const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/Bogota' });

const CLASE_CONEXION = {
  en_linea: 'adm-insignia adm-insignia-ok',
  retrasado: 'adm-insignia adm-insignia-aviso',
  sin_latido: 'adm-insignia adm-insignia-aviso',
  nunca: 'adm-insignia',
  desactivado: 'adm-insignia',
} as const;

export default async function PaginaAgenteImpresion() {
  const admin = await requerirAdmin({ modulo: 'agente', accion: 'agente.ver_estado' });
  const cliente = crearClienteServicio();
  const [agentes, cola] = await Promise.all([listarAgentes(cliente), listarCola(cliente)]);
  const vistas = conEstado(agentes);
  const gestiona = puede(admin.rol, 'agente.gestionar');

  return (
    <>
      <h1>Agente de impresión</h1>

      {vistas.length === 0 ? (
        <p className="adm-vacio">
          Aún no hay agentes. {gestiona ? 'Crea el primero abajo y pega su token en el PC de despacho.' : 'Pide a un administrador que cree el primero.'}
        </p>
      ) : (
        <div className="adm-tabla-caja">
          <table className="adm-tabla adm-tabla-apilada">
            <caption className="adm-suave">Agentes registrados</caption>
            <thead>
              <tr>
                <th scope="col">Agente</th>
                <th scope="col">Estado</th>
                <th scope="col">Último latido</th>
                <th scope="col">Impresora</th>
                <th scope="col">Versión</th>
                <th scope="col">Modo</th>
                <th scope="col">En cola</th>
                <th scope="col">Último error</th>
              </tr>
            </thead>
            <tbody>
              {vistas.map((a) => {
                const enCola = a.status_payload.queue_size;
                const error = a.status_payload.last_error;
                return (
                  <tr key={a.id}>
                    <td>{gestiona ? <Link href={`/admin/agente-impresion/${a.id}`}>{a.name}</Link> : a.name}</td>
                    <td data-etiqueta="Estado">
                      <span className={CLASE_CONEXION[a.conexion]}>{ETIQUETA_CONEXION[a.conexion]}</span>
                    </td>
                    <td data-etiqueta="Último latido" className="adm-suave">{a.last_heartbeat_at ? fecha.format(new Date(a.last_heartbeat_at)) : '—'}</td>
                    <td data-etiqueta="Impresora">{a.printer_name ?? '—'}</td>
                    <td data-etiqueta="Versión" className="adm-suave">{a.version ?? '—'}</td>
                    <td data-etiqueta="Modo">{a.mode === 'panel' ? 'Panel de MasterShop' : 'API'}</td>
                    <td data-etiqueta="En cola">{typeof enCola === 'number' ? enCola : '—'}</td>
                    <td data-etiqueta="Último error" className="adm-suave">{typeof error === 'string' && error ? error : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {puede(admin.rol, 'agente.pagina_prueba') ? (
        <section className="adm-form-ancho" aria-labelledby="h-prueba">
          <h2 id="h-prueba">Página de prueba</h2>
          <p className="adm-suave">Manda una hoja de prueba a la impresora para comprobar que todo está conectado.</p>
          <AccionSimple etiqueta="Imprimir página de prueba" accion={imprimirPaginaPrueba} />
        </section>
      ) : null}

      <section aria-labelledby="h-cola">
        <h2 id="h-cola">Últimos trabajos de impresión</h2>
        {cola.length === 0 ? (
          <p className="adm-vacio">Todavía no se ha pedido ninguna impresión.</p>
        ) : (
          <div className="adm-tabla-caja">
            <table className="adm-tabla adm-tabla-apilada">
              <caption className="adm-suave">Más recientes primero</caption>
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Pedido</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Origen</th>
                  <th scope="col">Creado</th>
                  <th scope="col">Detalle</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cola.map((t) => (
                  <tr key={t.id}>
                    <td>{ETIQUETA_TIPO_IMPRESION[t.type] ?? t.type}</td>
                    <td data-etiqueta="Pedido">
                      {t.order_id && t.orders ? <Link href={`/admin/pedidos/${t.order_id}`}>{t.orders.number}</Link> : '—'}
                    </td>
                    <td data-etiqueta="Estado">
                      <span className={t.status === 'failed' ? 'adm-insignia adm-insignia-aviso' : 'adm-insignia'}>
                        {ETIQUETA_IMPRESION[t.status] ?? t.status}
                      </span>
                    </td>
                    <td data-etiqueta="Origen" className="adm-suave">{t.requested_by === 'auto' ? 'Automática' : 'Panel'}</td>
                    <td data-etiqueta="Creado" className="adm-suave">{fecha.format(new Date(t.created_at))}</td>
                    <td data-etiqueta="Detalle" className="adm-suave">{t.status === 'failed' && t.error ? t.error : t.attempts > 1 ? `${t.attempts} intentos` : '—'}</td>
                    <td data-etiqueta="Acciones">
                      {t.type === 'label' && t.order_id && puede(admin.rol, 'agente.reimprimir') ? (
                        <AccionSimple etiqueta="Reimprimir" accion={reimprimirDesdeAgente.bind(null, t.order_id)} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {gestiona ? <NuevoAgente crear={crearAgente} /> : null}
    </>
  );
}
