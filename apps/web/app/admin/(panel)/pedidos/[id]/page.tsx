import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotonesCobro } from '@/components/admin/BotonesCobro';
import { evaluarCobro } from '@/lib/admin/pedidos/cobro';
import { dinero, obtenerDetallePedido } from '@/lib/admin/pedidos/detalle-servidor';
import { ETIQUETA_ESTADO_PEDIDO, ETIQUETA_EVENTO, ETIQUETA_MENSAJE, ETIQUETA_METODO_PAGO } from '@/lib/admin/pedidos/etiquetas';
import { ETIQUETA_CLAVE, type ClavePlantilla } from '@/lib/admin/whatsapp/etiquetas';
import { requerirAdmin } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/permissions';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { copiarLinkCobro, reenviarCobro } from '../acciones';

export const metadata: Metadata = { title: 'Detalle del pedido' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatoFecha(zona: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: zona });
}

export default async function DetallePedido({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requerirAdmin({ modulo: 'pedidos', accion: 'pedidos.ver' });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = await obtenerDetallePedido(crearClienteServicio(), id);
  if (!d) notFound();

  const { pedido: p } = d;
  // Las fechas se muestran en la zona del país del pedido (Bogotá para CO; Guayaquil para EC).
  const fecha = formatoFecha(p.country_code === 'EC' ? 'America/Guayaquil' : 'America/Bogota');
  const cobro = evaluarCobro(
    {
      payment_method: p.payment_method,
      status: p.status,
      stock_reserved_until: p.stock_reserved_until ? new Date(p.stock_reserved_until) : null,
    },
    d.link ? { expires_at: new Date(d.link.expires_at) } : null,
    new Date(),
  );
  const veCobro = p.payment_method === 'cod' && (puede(admin.rol, 'pedidos.copiar_link_cobro') || puede(admin.rol, 'pedidos.reenviar_cobro'));

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/pedidos">Pedidos</Link> / {p.number}
      </p>
      <div className="adm-cabecera">
        <h1>Pedido {p.number}</h1>
        <span className="adm-insignia">{ETIQUETA_ESTADO_PEDIDO[p.status] ?? p.status}</span>
      </div>
      <p className="adm-suave">
        {p.country_code} · {ETIQUETA_METODO_PAGO[p.payment_method] ?? p.payment_method} · creado {fecha.format(new Date(p.created_at))}
      </p>

      {veCobro ? (
        <section className="adm-form-ancho" aria-labelledby="h-cobro">
          <h2 id="h-cobro">Cobro del abono</h2>
          <p>
            Abono {dinero(p.cod_deposit_amount, p.currency_code)} · al recibir {dinero(p.cod_collect_amount, p.currency_code)}
            {d.link ? (
              <>
                {' '}
                · link {cobro.linkVigente ? 'vigente' : 'vencido'} hasta {fecha.format(new Date(d.link.expires_at))} ·{' '}
                {d.link.clicks} clic{d.link.clicks === 1 ? '' : 's'}
              </>
            ) : (
              ' · aún sin link de cobro'
            )}
            {p.stock_reserved_until ? <> · reserva hasta {fecha.format(new Date(p.stock_reserved_until))}</> : null}
          </p>
          <BotonesCobro
            puedeCopiar={cobro.puedeCopiar && puede(admin.rol, 'pedidos.copiar_link_cobro')}
            puedeReenviar={cobro.puedeReenviar && puede(admin.rol, 'pedidos.reenviar_cobro')}
            motivo={cobro.motivo}
            copiar={copiarLinkCobro.bind(null, p.id)}
            reenviar={reenviarCobro.bind(null, p.id)}
          />
        </section>
      ) : null}

      <section className="adm-form-ancho" aria-labelledby="h-resumen">
        <h2 id="h-resumen">Resumen</h2>
        <p>
          {p.contact_first_name} {p.contact_last_name} · {p.contact_phone_e164}
          {p.contact_email ? ` · ${p.contact_email}` : ''}
        </p>
        <p className="adm-suave">
          {[p.shipping_address1, p.shipping_city_name, p.shipping_region_name].filter(Boolean).join(', ') || 'Sin dirección'}
        </p>
        <p>
          Subtotal {dinero(p.subtotal, p.currency_code)}
          {p.discount_amount > 0 ? ` · descuento −${dinero(p.discount_amount, p.currency_code)}` : ''}
          {p.financing_surcharge_amount > 0 ? ` · recargo ${dinero(p.financing_surcharge_amount, p.currency_code)}` : ''} ·{' '}
          <strong>Total {dinero(p.total_customer, p.currency_code)}</strong>
        </p>
      </section>

      <section aria-labelledby="h-pagos">
        <h2 id="h-pagos">Pagos</h2>
        {d.pagos.length === 0 ? (
          <p className="adm-vacio">Aún no hay intentos de pago.</p>
        ) : (
          <div className="adm-tabla-caja">
            <table className="adm-tabla">
              <caption className="adm-suave">Intentos de pago del pedido</caption>
              <thead>
                <tr>
                  <th scope="col">Referencia</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {d.pagos.map((x) => (
                  <tr key={x.id}>
                    <td className="adm-suave">{x.provider_reference ?? '—'}</td>
                    <td>{x.provider}</td>
                    <td>{x.purpose === 'cod_deposit' ? 'Abono' : x.purpose === 'full' ? 'Completo' : 'Financiación'}</td>
                    <td>{dinero(x.amount, p.currency_code)}</td>
                    <td>{x.status}</td>
                    <td className="adm-suave">{fecha.format(new Date(x.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="h-wa">
        <h2 id="h-wa">Mensajes de WhatsApp</h2>
        {d.mensajes.length === 0 ? (
          <p className="adm-vacio">No se han enviado mensajes de este pedido.</p>
        ) : (
          <div className="adm-tabla-caja">
            <table className="adm-tabla">
              <caption className="adm-suave">Mensajes enviados por plantilla</caption>
              <thead>
                <tr>
                  <th scope="col">Plantilla</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Programado</th>
                  <th scope="col">Enviado</th>
                </tr>
              </thead>
              <tbody>
                {d.mensajes.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.whatsapp_templates
                        ? `${ETIQUETA_CLAVE[m.whatsapp_templates.key as ClavePlantilla] ?? m.whatsapp_templates.key} (v${m.whatsapp_templates.version})`
                        : '—'}
                    </td>
                    <td>
                      <span className={m.status === 'failed' ? 'adm-insignia adm-insignia-aviso' : 'adm-insignia'}>
                        {ETIQUETA_MENSAJE[m.status] ?? m.status}
                      </span>
                      {m.status === 'failed' && m.error_code ? <span className="adm-suave adm-chico"> código {m.error_code}</span> : null}
                    </td>
                    <td className="adm-suave">{m.scheduled_for ? fecha.format(new Date(m.scheduled_for)) : '—'}</td>
                    <td className="adm-suave">{m.sent_at ? fecha.format(new Date(m.sent_at)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="h-linea">
        <h2 id="h-linea">Línea de tiempo</h2>
        {d.eventos.length === 0 ? (
          <p className="adm-vacio">Sin eventos todavía.</p>
        ) : (
          <ol>
            {d.eventos.map((e) => (
              <li key={e.id}>
                <strong>{ETIQUETA_EVENTO[e.type] ?? e.type}</strong>
                {e.from_status || e.to_status
                  ? `: ${ETIQUETA_ESTADO_PEDIDO[e.from_status ?? ''] ?? e.from_status ?? '—'} → ${ETIQUETA_ESTADO_PEDIDO[e.to_status ?? ''] ?? e.to_status ?? '—'}`
                  : ''}{' '}
                <span className="adm-suave adm-chico">
                  {fecha.format(new Date(e.created_at))} · {e.actor.startsWith('admin:') ? 'panel' : e.actor}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
