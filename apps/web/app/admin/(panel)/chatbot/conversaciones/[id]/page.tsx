import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatoUsdMicros } from '@/lib/admin/chatbot/chatbot';
import { herramientasDe, obtenerConversacion } from '@/lib/admin/chatbot/servidor';
import { fechaHoraBogota } from '@/lib/admin/formato';
import { requerirAdmin } from '@/lib/auth/guard';
import { crearClienteServicio } from '@/lib/auth/supabase/servicio';

export const metadata: Metadata = { title: 'Conversación de Iza' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DetalleConversacion({ params }: { params: Promise<{ id: string }> }) {
  await requerirAdmin({ modulo: 'chatbot', accion: 'chatbot.gestionar' });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const c = await obtenerConversacion(crearClienteServicio(), id);
  if (!c) notFound();
  const visibles = c.mensajes.filter((m) => m.role === 'user' || m.role === 'assistant');

  return (
    <>
      <p className="adm-migas">
        <Link href="/admin/chatbot">Chatbot</Link> / <Link href="/admin/chatbot/conversaciones">Conversaciones</Link> / {fechaHoraBogota(c.sesion.started_at)}
      </p>
      <h1>Conversación</h1>
      <p className="adm-suave">
        {c.sesion.country_code} · {c.sesion.messages_count} mensajes · costo {formatoUsdMicros(c.costoTotal)} ·{' '}
        {c.sesion.converted_order_id ? <Link href={`/admin/pedidos/${c.sesion.converted_order_id}`}>terminó en pedido</Link> : 'no terminó en pedido'}
        {c.sesion.customer_id ? (
          <>
            {' '}
            · <Link href={`/admin/clientes/${c.sesion.customer_id}`}>cliente con cuenta</Link>
          </>
        ) : null}
      </p>
      {visibles.length === 0 ? (
        <p className="adm-vacio">Sin mensajes visibles.</p>
      ) : (
        <ol className="adm-lista-simple" aria-label="Mensajes">
          {visibles.map((m) => {
            const herramientas = herramientasDe(m.tool_calls);
            return (
              <li key={m.id} className="adm-tarjeta">
                <p className="adm-suave adm-chico">
                  <strong>{m.role === 'user' ? 'Visitante' : 'Iza'}</strong> · {fechaHoraBogota(m.created_at)}
                  {m.model ? ` · ${m.model}` : ''}
                  {m.cost_usd_micros > 0n ? ` · ${formatoUsdMicros(m.cost_usd_micros)}` : ''}
                </p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.content ?? <span className="adm-suave">(sin texto)</span>}</p>
                {herramientas.length > 0 ? <p className="adm-suave adm-chico">Consultó: {herramientas.join(', ')}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
