import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormularioGarantia } from '@/components/admin/FormularioGarantia';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { ETIQUETA_ESTADO_GARANTIA, transicionesDe } from '@/lib/admin/garantias/garantias';
import { obtenerGarantia } from '@/lib/admin/garantias/servidor';
import { MONEDA_PAIS, montoATexto } from '@/lib/admin/pagos/ajustes';
import { ETIQUETA_ESTADO_PEDIDO } from '@/lib/admin/pedidos/etiquetas';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';
import { gestionarGarantia } from '../acciones';

export const metadata: Metadata = { title: 'Garantía' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DetalleGarantia({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requerirAdmin({ modulo: 'garantias', accion: 'garantias.gestionar' });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const d = await obtenerGarantia(crearClienteServicio(), id);
  if (!d) notFound();
  const { caso, pedido, historial, fotos, limite } = d;
  const moneda = MONEDA_PAIS[caso.country_code];

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/garantias">Garantías</Link> / {caso.number}
      </p>
      <h1>
        {caso.number} <span className="adm-insignia">{ETIQUETA_ESTADO_GARANTIA[caso.status]}</span>
      </h1>
      {sp.guardado ? (
        <p className="adm-ok" role="status">
          Cambios guardados.
        </p>
      ) : null}
      {limite.vencida ? (
        <p className="adm-alerta" role="alert">
          El plazo de respuesta venció el {fechaHoraBogota(limite.fecha)}.
        </p>
      ) : null}

      <div className="adm-rejilla">
        <section className="adm-tarjeta" aria-labelledby="g-cliente">
          <h2 id="g-cliente">Cliente</h2>
          <p>{caso.customer_name}</p>
          <p>
            <a href={`tel:${caso.phone}`}>{caso.phone}</a>
          </p>
          {caso.email ? (
            <p>
              <a href={`mailto:${caso.email}`}>{caso.email}</a>
            </p>
          ) : null}
        </section>
        <section className="adm-tarjeta" aria-labelledby="g-pedido">
          <h2 id="g-pedido">Pedido</h2>
          {pedido ? (
            <>
              <p>
                <Link href={`/admin/pedidos/${pedido.id}`}>{pedido.number}</Link>
              </p>
              <p className="adm-suave">
                {ETIQUETA_ESTADO_PEDIDO[pedido.status] ?? pedido.status}
                {pedido.delivered_at ? ` · entregado el ${fechaHoraBogota(pedido.delivered_at)}` : ''}
              </p>
            </>
          ) : (
            <p className="adm-suave">Sin pedido vinculado.</p>
          )}
        </section>
        <section className="adm-tarjeta" aria-labelledby="g-fechas">
          <h2 id="g-fechas">Fechas</h2>
          <p className="adm-suave">Recibida: {fechaHoraBogota(caso.created_at)}</p>
          <p className="adm-suave">Responder antes de: {fechaHoraBogota(limite.fecha)}</p>
          {caso.resolved_at ? <p className="adm-suave">Resuelta: {fechaHoraBogota(caso.resolved_at)}</p> : null}
        </section>
      </div>

      <section aria-labelledby="g-solicitud">
        <h2 id="g-solicitud">Solicitud</h2>
        <p>
          <strong>Motivo:</strong> {caso.reason}
        </p>
        {caso.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{caso.description}</p> : <p className="adm-suave">Sin descripción.</p>}
        {fotos.length > 0 ? (
          <ul className="adm-lista-simple" aria-label="Fotos del caso">
            {fotos.map((f) => (
              <li key={f.id}>
                <a href={`/media/${f.ruta}`} target="_blank" rel="noopener noreferrer">
                  <img className="adm-miniatura" src={`/media/${f.ruta}`} alt={f.alt} loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-suave adm-chico">Sin fotos en el sistema. Si adjuntó un video, está en el disco del servidor.</p>
        )}
      </section>

      <section aria-labelledby="g-gestion">
        <h2 id="g-gestion">Gestión</h2>
        <FormularioGarantia
          key={`${caso.id}-${caso.updated_at}`}
          accion={gestionarGarantia}
          moneda={moneda}
          estadosPermitidos={transicionesDe(caso.status)}
          inicial={{
            id: caso.id,
            status: caso.status,
            resolution: caso.resolution ?? '',
            cost_amount: montoATexto(caso.cost_amount, moneda),
            admin_notes: caso.admin_notes ?? '',
          }}
        />
      </section>

      <section aria-labelledby="g-historial">
        <h2 id="g-historial">Historial</h2>
        {historial.length === 0 ? (
          <p className="adm-vacio">Sin movimientos todavía.</p>
        ) : (
          <ol className="adm-lista-simple">
            {[...historial].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <strong>
                  {h.from ? `${ETIQUETA_ESTADO_GARANTIA[h.from]} → ` : ''}
                  {ETIQUETA_ESTADO_GARANTIA[h.to]}
                </strong>
                <span className="adm-suave adm-chico">
                  {' '}
                  · {fechaHoraBogota(h.at)} · {h.actor.slice(0, 8)}
                </span>
                {h.nota ? <p className="adm-suave">{h.nota}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
