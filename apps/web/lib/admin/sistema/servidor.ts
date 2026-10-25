import 'server-only';
/**
 * Sistema (§24.1) con el cliente de servicio: lista de auditoría, errores recientes y volumen de datos. Solo
 * lectura. (Las colas están en `colas.ts`.) Los mensajes de WhatsApp fallidos se listan sin el número del destinatario.
 */
import { inicioDiaBogotaUtc, sumarDias } from '@izao/core/metrics';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { escaparBusqueda, rangoPagina } from '../crud/comun';
import { ENTIDAD_ACCESOS, esUuid, type FiltrosAuditoria } from './auditoria';

export type EventoAuditoria = {
  id: string;
  actor: string;
  /** Nombre de la persona del panel si el actor es un usuario conocido. */
  actorNombre: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  diff: unknown;
  ip: string | null;
  created_at: string;
};

export async function listarAuditoria(cliente: Cliente, f: FiltrosAuditoria): Promise<{ filas: EventoAuditoria[]; total: number }> {
  let q = cliente.from('audit_log').select('id, actor, action, entity, entity_id, diff, ip, created_at', { count: 'exact' });
  if (f.entidad) q = q.eq('entity', f.entidad);
  else if (!f.accesos) q = q.neq('entity', ENTIDAD_ACCESOS);
  if (f.actor) q = q.eq('actor', f.actor);
  if (f.accion) q = q.ilike('action', `${escaparBusqueda(f.accion)}%`);
  if (f.desde) q = q.gte('created_at', inicioDiaBogotaUtc(f.desde).toISOString());
  if (f.hasta) q = q.lt('created_at', inicioDiaBogotaUtc(sumarDias(f.hasta, 1)).toISOString());
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudo leer la auditoría: ${error.message}`);
  const filas = (data ?? []) as unknown as Omit<EventoAuditoria, 'actorNombre'>[];

  const ids = [...new Set(filas.map((e) => e.actor).filter(esUuid))];
  const nombres = new Map<string, string>();
  if (ids.length > 0) {
    const { data: admins } = await cliente.from('admin_users').select('auth_user_id, name').in('auth_user_id', ids);
    for (const a of (admins ?? []) as { auth_user_id: string; name: string }[]) nombres.set(a.auth_user_id, a.name);
  }
  return { filas: filas.map((e) => ({ ...e, actorNombre: nombres.get(e.actor) ?? null })), total: count ?? 0 };
}

export type ErroresRecientes = {
  webhooks: { id: string; provider: string; event_id: string; error: string; created_at: string }[];
  impresiones: { id: string; type: string; error: string | null; attempts: number; created_at: string }[];
  whatsapp: { id: string; error_code: string | null; error_text: string | null; order_id: string | null; created_at: string }[];
  pedidosErrorTransportadora: number;
};

const LIMITE = 15;

export async function erroresRecientes(cliente: Cliente): Promise<ErroresRecientes> {
  const [wh, imp, wa, ped] = await Promise.all([
    cliente
      .from('webhook_events')
      .select('id, provider, event_id, error, created_at')
      .not('error', 'is', null)
      .is('processed_at', null)
      .order('created_at', { ascending: false })
      .limit(LIMITE),
    cliente
      .from('print_jobs')
      .select('id, type, error, attempts, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(LIMITE),
    cliente
      .from('whatsapp_messages')
      .select('id, error_code, error_text, order_id, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(LIMITE),
    cliente.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'error_transportadora'),
  ]);
  for (const [r, que] of [[wh, 'los webhooks'], [imp, 'las impresiones'], [wa, 'los mensajes'], [ped, 'los pedidos']] as const) {
    if (r.error) throw new Error(`No se pudieron leer ${que}: ${r.error.message}`);
  }
  return {
    webhooks: (wh.data ?? []) as unknown as ErroresRecientes['webhooks'],
    impresiones: (imp.data ?? []) as unknown as ErroresRecientes['impresiones'],
    whatsapp: (wa.data ?? []) as unknown as ErroresRecientes['whatsapp'],
    pedidosErrorTransportadora: ped.count ?? 0,
  };
}

/** Tablas que más crecen. El plan gratuito de Supabase limita la base a 500 MB (§4): esto avisa antes de llegar. */
export const TABLAS_VOLUMEN = [
  ['orders', 'Pedidos'],
  ['order_items', 'Líneas de pedido'],
  ['audit_log', 'Auditoría'],
  ['webhook_events', 'Eventos de webhooks'],
  ['chat_messages', 'Mensajes del chat'],
  ['whatsapp_messages', 'Mensajes de WhatsApp'],
  ['media', 'Imágenes'],
] as const;

export async function volumenDeDatos(cliente: Cliente): Promise<{ tabla: string; etiqueta: string; filas: number }[]> {
  return Promise.all(
    TABLAS_VOLUMEN.map(async ([tabla, etiqueta]) => {
      const { count, error } = await cliente.from(tabla).select('*', { count: 'estimated', head: true });
      if (error) throw new Error(`No se pudo contar ${etiqueta}: ${error.message}`);
      return { tabla, etiqueta, filas: count ?? 0 };
    }),
  );
}
