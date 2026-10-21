import 'server-only';
/**
 * Copiar el link de cobro y reenviar el cobro de un pedido contra entrega (§13.3). Cada solicitud se audita y
 * deja un evento en la línea de tiempo del pedido. El token del link solo sale del servidor cuando una persona con
 * permiso pide copiarlo, y esa petición queda registrada.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import {
  ESPERA_REENVIO_SEGUNDOS,
  MENSAJE_ENCOLADO,
  evaluarCobro,
  urlCobro,
  type EstadoCobro,
  type LinkCobro,
  type PedidoCobro,
  type ResultadoEncolado,
} from './cobro';

type Ctx = { cliente: Cliente; actor: string; ip: string | null; ahora?: () => Date };

export const TIPO_EVENTO_REENVIO = 'cobro_reenvio_solicitado';

export type ResultadoCobro<T = Record<string, never>> =
  | ({ ok: true; mensaje?: string } & T)
  | { ok: false; mensaje: string };

async function cargar(cliente: Cliente, orderId: string): Promise<{ pedido: PedidoCobro & { number: string }; link: LinkCobro | null } | null> {
  const { data: o, error } = await cliente
    .from('orders')
    .select('number, payment_method, status, stock_reserved_until')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw new Error('No se pudo leer el pedido.');
  if (!o) return null;
  const fila = o as { number: string; payment_method: string; status: string; stock_reserved_until: string | null };
  const { data: l, error: e2 } = await cliente
    .from('pay_links')
    .select('token, expires_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (e2) throw new Error('No se pudo leer el link de cobro.');
  const ultimo = (Array.isArray(l) ? l[0] : null) as { token: string; expires_at: string } | null | undefined;
  return {
    pedido: {
      number: fila.number,
      payment_method: fila.payment_method,
      status: fila.status,
      stock_reserved_until: fila.stock_reserved_until ? new Date(fila.stock_reserved_until) : null,
    },
    link: ultimo ? { token: ultimo.token, expires_at: new Date(ultimo.expires_at) } : null,
  };
}

/** Estado del cobro para pintar los botones (sin token). */
export async function estadoCobroBd(cliente: Cliente, orderId: string, ahora: Date = new Date()): Promise<EstadoCobro | null> {
  const c = await cargar(cliente, orderId);
  return c ? evaluarCobro(c.pedido, c.link, ahora) : null;
}

/** Devuelve la URL del link vigente y registra quién la pidió. */
export async function linkCobroBd(args: Ctx & { orderId: string; origen: string }): Promise<ResultadoCobro<{ url: string }>> {
  const { cliente, orderId, actor, ip } = args;
  const ahora = (args.ahora ?? (() => new Date()))();
  const c = await cargar(cliente, orderId);
  if (!c) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  const estado = evaluarCobro(c.pedido, c.link, ahora);
  if (!estado.puedeCopiar || !c.link) {
    return {
      ok: false,
      mensaje: estado.motivo ?? 'No hay un link de cobro vigente. Usa "Reenviar cobro" para que el sistema lo genere.',
    };
  }
  await auditarCambio({
    actor,
    accion: 'pedido.link_cobro_copiado',
    entidad: 'orders',
    entidadId: orderId,
    diff: { numero: c.pedido.number },
    ip,
  });
  return { ok: true, url: urlCobro(args.origen, c.link.token) };
}

/**
 * Pide al worker que reenvíe el cobro (job `cod.reenviar`, mismo link si sigue vigente). Un segundo clic dentro
 * del minuto se rechaza; el tope total de reenvíos por pedido lo aplica el worker.
 */
export async function reenviarCobroBd(
  args: Ctx & { orderId: string; encolar: (orderId: string) => Promise<ResultadoEncolado> },
): Promise<ResultadoCobro<{ resultado: ResultadoEncolado }>> {
  const { cliente, orderId, actor, ip } = args;
  const ahora = (args.ahora ?? (() => new Date()))();
  const c = await cargar(cliente, orderId);
  if (!c) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  const estado = evaluarCobro(c.pedido, c.link, ahora);
  if (!estado.puedeReenviar) return { ok: false, mensaje: estado.motivo ?? 'No se puede reenviar el cobro de este pedido.' };

  const desde = new Date(ahora.getTime() - ESPERA_REENVIO_SEGUNDOS * 1000).toISOString();
  const { data: recientes, error: e1 } = await cliente
    .from('order_events')
    .select('id')
    .eq('order_id', orderId)
    .eq('type', TIPO_EVENTO_REENVIO)
    .gte('created_at', desde)
    .limit(1);
  if (e1) return { ok: false, mensaje: 'No se pudo verificar el último reenvío. Inténtalo de nuevo.' };
  if (Array.isArray(recientes) && recientes.length > 0) {
    return { ok: false, mensaje: `Ya se pidió un reenvío hace menos de ${ESPERA_REENVIO_SEGUNDOS} segundos. Espera un momento.` };
  }

  let resultado: ResultadoEncolado;
  try {
    resultado = await args.encolar(orderId);
  } catch (e) {
    console.error('[panel] no se pudo encolar el cobro:', e instanceof Error ? e.name : 'error');
    return { ok: false, mensaje: 'No se pudo poner el cobro en cola. Inténtalo de nuevo en un momento.' };
  }

  const { error: e2 } = await cliente.from('order_events').insert({
    order_id: orderId,
    type: TIPO_EVENTO_REENVIO,
    payload: { resultado },
    actor: `admin:${actor}`,
  });
  if (e2) console.error('[panel] no se pudo registrar el evento de reenvío:', e2.code ?? 'error');
  await auditarCambio({
    actor,
    accion: 'pedido.cobro_reenviado',
    entidad: 'orders',
    entidadId: orderId,
    diff: { numero: c.pedido.number, resultado },
    ip,
  });
  return { ok: true, resultado, mensaje: MENSAJE_ENCOLADO[resultado] };
}
