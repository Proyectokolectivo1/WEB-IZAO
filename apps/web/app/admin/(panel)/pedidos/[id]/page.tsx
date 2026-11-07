import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ESTADOS_REINTENTO_ENVIO } from '@izao/mastershop';
import { isOrderStatus, puedeTransicionar } from '@izao/core/order-state';
import { AccionConTexto, AccionSimple, FormularioNota } from '@/components/admin/AccionesPedido';
import { BotonesCobro } from '@/components/admin/BotonesCobro';
import { evaluarCobro } from '@/lib/admin/pedidos/cobro';
import { dinero, obtenerDetallePedido } from '@/lib/admin/pedidos/detalle-servidor';
import {
  ETIQUETA_ESTADO_PEDIDO,
  ETIQUETA_EVENTO,
  ETIQUETA_IMPRESION,
  ETIQUETA_MENSAJE,
  ETIQUETA_METODO_PAGO,
  ETIQUETA_TIPO_IMPRESION,
} from '@/lib/admin/pedidos/etiquetas';
import { ETIQUETA_CLAVE, type ClavePlantilla } from '@/lib/admin/whatsapp/etiquetas';
import { requerirAdmin } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/permissions';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { agregarNota, cancelarPedido, copiarLinkCobro, marcarPagado, reenviarCobro, reimprimirEtiqueta, reintentarEnvio } from '../acciones';

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

  // Qué acciones aplican según el estado (la regla real la vuelve a comprobar el servidor) y el permiso del rol.
  const puedeCancelar = puede(admin.rol, 'pedidos.cancelar') && isOrderStatus(p.status) && puedeTransicionar(p.status, 'cancelado');
  const puedeMarcarPagado = puede(admin.rol, 'pedidos.marcar_pagado') && p.status === 'pendiente_manual';
  const puedeReintentar = puede(admin.rol, 'pedidos.reintentar_envio');
  const reintentoValido = ESTADOS_REINTENTO_ENVIO.has(p.status);
  const puedeReimprimir = puede(admin.rol, 'pedidos.reimprimir');
  const urlEtiqueta = d.envio?.etiqueta_url ?? null;
  const hayEtiqueta = d.envio?.etiqueta_lista === true || urlEtiqueta !== null;
  const whatsappFallo = d.mensajes.some((m) => m.status === 'failed');
  const notas = d.eventos.filter((e) => e.type === 'nota_interna' && e.nota);

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/pedidos">Pedidos</Link> / {p.number}
      </p>
      <div className="adm-cabecera">
        <h1>Pedido {p.number}</h1>
        <span className="adm-insignia">{ETIQUETA_ESTADO_PEDIDO[p.status] ?? p.status}</span>
        {d.envio?.has_novelty ? <span className="adm-insignia adm-insignia-aviso">Novedad</span> : null}
        {p.status === 'error_transportadora' ? <span className="adm-insignia adm-insignia-aviso">Error transportadora</span> : null}
        {whatsappFallo ? <span className="adm-insignia adm-insignia-aviso">WhatsApp falló</span> : null}
      </div>
      <p className="adm-suave">
        {p.country_code} · {ETIQUETA_METODO_PAGO[p.payment_method] ?? p.payment_method} · creado {fecha.format(new Date(p.created_at))}
      </p>

      <section className="adm-form-ancho" aria-labelledby="h-acciones">
        <h2 id="h-acciones">Acciones</h2>
        <div className="adm-acciones">
          {puedeReintentar ? (
            <AccionSimple
              etiqueta="Reintentar envío a MasterShop"
              accion={reintentarEnvio.bind(null, p.id)}
              deshabilitada={!reintentoValido}
              motivo="Solo disponible con el pedido pagado, con abono pagado o con error de transportadora."
            />
          ) : null}
          {puedeReimprimir ? (
            <AccionSimple
              etiqueta="Reimprimir etiqueta"
              accion={reimprimirEtiqueta.bind(null, p.id)}
              deshabilitada={!hayEtiqueta}
              motivo="La etiqueta todavía no está disponible."
            />
          ) : null}
        </div>
        {puedeMarcarPagado ? (
          <AccionConTexto
            etiqueta="Marcar como pagado"
            advertencia="Confirma que recibiste el dinero de este pedido. Se descuenta el stock y el pedido pasa a envío. No se puede deshacer."
            etiquetaCampo="Referencia del pago (transferencia, recibo)"
            etiquetaConfirmar="Sí, marcar como pagado"
            maximo={200}
            accion={marcarPagado.bind(null, p.id)}
          />
        ) : null}
        {puedeCancelar ? (
          <AccionConTexto
            etiqueta="Cancelar pedido"
            advertencia="El pedido pasa a Cancelado y se libera el stock reservado. Si el envío está creado en MasterShop, también se cancela allá. No se puede deshacer."
            etiquetaCampo="Motivo de la cancelación"
            etiquetaConfirmar="Sí, cancelar el pedido"
            peligro
            accion={cancelarPedido.bind(null, p.id)}
          />
        ) : null}
        {!puede(admin.rol, 'pedidos.cancelar') ? (
          <p className="adm-suave adm-chico">Cancelar y marcar como pagado los hace un administrador.</p>
        ) : null}
      </section>

      {d.envio ? (
        <section className="adm-form-ancho" aria-labelledby="h-envio">
          <h2 id="h-envio">Envío</h2>
          <p>
            {d.envio.carrier_name ?? 'Transportadora por asignar'}
            {d.envio.provider_status_name ? ` · ${d.envio.provider_status_name}` : ''}
            {d.envio.tracking_code ? ` · guía ${d.envio.tracking_code}` : ''}
          </p>
          <p className="adm-suave adm-chico">
            Etiqueta {d.envio.etiqueta_lista ? 'descargada' : urlEtiqueta ? 'disponible en MasterShop (el agente la descarga al imprimir)' : 'aún no disponible'}.
          </p>
          {urlEtiqueta ? (
            <p>
              <a href={urlEtiqueta} target="_blank" rel="noopener noreferrer">
                Abrir etiqueta en MasterShop
              </a>
            </p>
          ) : null}
          {d.impresiones.length > 0 ? (
            <ul>
              {d.impresiones.map((i) => (
                <li key={i.id}>
                  {ETIQUETA_TIPO_IMPRESION[i.type] ?? i.type} · {ETIQUETA_IMPRESION[i.status] ?? i.status} ·{' '}
                  {i.requested_by === 'auto' ? 'automática' : 'reimpresión del panel'}
                  <span className="adm-suave adm-chico"> {fecha.format(new Date(i.created_at))}</span>
                  {i.status === 'failed' && i.error ? <span className="adm-suave adm-chico"> · {i.error}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

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

      {puede(admin.rol, 'pedidos.nota') ? (
        <section aria-labelledby="h-notas">
          <h2 id="h-notas">Notas internas</h2>
          {notas.length === 0 ? <p className="adm-vacio">Aún no hay notas. Escribe la primera.</p> : null}
          <ul>
            {notas.map((n) => (
              <li key={n.id}>
                {n.nota}{' '}
                <span className="adm-suave adm-chico">
                  {fecha.format(new Date(n.created_at))} · {n.actor.startsWith('admin:') ? 'panel' : n.actor}
                </span>
              </li>
            ))}
          </ul>
          <FormularioNota accion={agregarNota.bind(null, p.id)} />
        </section>
      ) : null}

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
