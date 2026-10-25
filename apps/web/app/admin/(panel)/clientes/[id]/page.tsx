import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormularioAnonimizar } from '@/components/admin/FormularioAnonimizar';
import { nombreDeCliente } from '@/lib/admin/clientes/clientes';
import { obtenerCliente } from '@/lib/admin/clientes/servidor';
import { dinero } from '@/lib/admin/pedidos/detalle-servidor';
import { ETIQUETA_ESTADO_PEDIDO } from '@/lib/admin/pedidos/etiquetas';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { anonimizarCliente } from '../acciones';

export const metadata: Metadata = { title: 'Cliente' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DetalleCliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'clientes', accion: 'clientes.gestionar' });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const d = await obtenerCliente(crearClienteServicio(), id);
  if (!d) notFound();
  const { cliente: c, pedidos, bloqueos } = d;

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/clientes">Clientes</Link> / {nombreDeCliente(c)}
      </p>
      <h1>{nombreDeCliente(c)}</h1>
      {sp.anonimizado ? (
        <p className="adm-ok" role="status">
          Cliente anonimizado. Se conservaron los montos, fechas y estados de sus pedidos para la contabilidad.
        </p>
      ) : null}

      <section aria-labelledby="h-datos">
        <h2 id="h-datos">Datos</h2>
        {c.anonymized_at ? (
          <p className="adm-suave">Anonimizado el {fechaHoraBogota(c.anonymized_at)}. Ya no quedan datos personales.</p>
        ) : (
          <dl className="adm-lista-simple">
            <div>
              <dt className="adm-suave">País</dt>
              <dd>{c.country_code}</dd>
            </div>
            <div>
              <dt className="adm-suave">Correo</dt>
              <dd>{c.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="adm-suave">Celular</dt>
              <dd>{c.phone_e164 ?? '—'}</dd>
            </div>
            <div>
              <dt className="adm-suave">Documento</dt>
              <dd>{c.document_number ? `${c.document_type ?? ''} ${c.document_number}`.trim() : '—'}</dd>
            </div>
            <div>
              <dt className="adm-suave">Comunicaciones</dt>
              <dd>
                {c.marketing_opt_in ? 'Acepta mercadeo' : 'Sin mercadeo'} · {c.whatsapp_opt_in ? 'Acepta WhatsApp' : 'Sin WhatsApp'}
              </dd>
            </div>
            <div>
              <dt className="adm-suave">Direcciones guardadas</dt>
              <dd>{d.direcciones}</dd>
            </div>
            <div>
              <dt className="adm-suave">Cliente desde</dt>
              <dd>{fechaHoraBogota(c.created_at)}</dd>
            </div>
          </dl>
        )}
      </section>

      {c.anonymized_at ? null : (
        <>
          <section aria-labelledby="h-pedidos">
            <h2 id="h-pedidos">Pedidos</h2>
            {pedidos.length === 0 ? (
              <p className="adm-vacio">Sin pedidos.</p>
            ) : (
              <div className="adm-tabla-caja">
                <table className="adm-tabla">
                  <caption className="adm-suave">Pedidos del cliente (incluye compras como invitado con el mismo celular o correo)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pedido</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Total</th>
                      <th scope="col">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/admin/pedidos/${p.id}`}>{p.number}</Link>
                        </td>
                        <td>
                          <span className="adm-insignia">{ETIQUETA_ESTADO_PEDIDO[p.status] ?? p.status}</span>
                        </td>
                        <td>{dinero(Number(p.total_customer), p.currency_code)}</td>
                        <td className="adm-suave">{fechaHoraBogota(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="h-anonimizar">
            <h2 id="h-anonimizar">Anonimizar (habeas data)</h2>
            <p className="adm-suave">
              Atiende una solicitud de supresión. Se borran el nombre, correo, celular, documento, direcciones, lista de deseos,
              conversaciones con Iza, leads y la cuenta de acceso, y se neutralizan los datos de contacto y la dirección de sus
              pedidos y garantías. Se conservan montos, fechas, estados y ciudad para la contabilidad. No se puede deshacer.
            </p>
            {bloqueos.length > 0 ? (
              <div className="adm-aviso" role="status">
                {bloqueos.map((b) => (
                  <p key={b}>{b}</p>
                ))}
              </div>
            ) : (
              <FormularioAnonimizar id={c.id} accion={anonimizarCliente} />
            )}
          </section>
        </>
      )}
    </>
  );
}
