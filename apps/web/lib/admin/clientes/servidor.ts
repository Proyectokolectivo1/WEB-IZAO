import 'server-only';
/**
 * Clientes (§24.1, §26.2) con el cliente de servicio: lista, detalle con pedidos y anonimización por habeas data.
 *
 * La anonimización no es una sola transacción (no hay RPC todavía): cada paso es idempotente y la marca
 * `customers.anonymized_at` se escribe al FINAL, así que si algo falla el cliente sigue sin marcar y la acción se puede
 * repetir sin riesgo. Nunca se registra en la auditoría ningún dato personal, ni el anterior ni el nuevo.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { escaparBusqueda, rangoPagina, type ResultadoAccion } from '../crud/comun';
import {
  ESTADOS_GARANTIA_ABIERTOS,
  MARCA_ANONIMIZADO,
  bloqueosAnonimizacion,
  interpretarBusquedaCliente,
  pedidoEnCurso,
  type DatosAnonimizar,
  type FiltrosCliente,
} from './clientes';

type Ctx = { cliente: Cliente; actor: string; ip: string | null };
type Monto = number | string | bigint;

export type FilaCliente = {
  id: string;
  country_code: 'CO' | 'EC';
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string | null;
  marketing_opt_in: boolean;
  whatsapp_opt_in: boolean;
  anonymized_at: string | null;
  created_at: string;
};

const COLUMNAS =
  'id, country_code, first_name, last_name, email, phone_e164, marketing_opt_in, whatsapp_opt_in, anonymized_at, created_at';

/** Solo letras, números, espacio, guion y apóstrofo: así el valor es seguro dentro de un filtro `.or()`. */
function tokenDeNombre(texto: string): string {
  const primero = texto.trim().split(/\s+/)[0] ?? '';
  return primero.replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, 40);
}

export async function listarClientes(cliente: Cliente, f: FiltrosCliente): Promise<{ filas: FilaCliente[]; total: number }> {
  let q = cliente.from('customers').select(COLUMNAS, { count: 'exact' });
  if (f.pais) q = q.eq('country_code', f.pais);
  if (f.estado === 'anonimizados') q = q.not('anonymized_at', 'is', null);
  if (f.estado === 'activos') q = q.is('anonymized_at', null);
  const b = interpretarBusquedaCliente(f.q);
  if (b) {
    if (b.campo === 'nombre') {
      const t = tokenDeNombre(b.patron);
      if (t) q = q.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
    } else {
      q = q.ilike(b.campo, `%${escaparBusqueda(b.patron)}%`);
    }
  }
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar los clientes: ${error.message}`);
  return { filas: (data ?? []) as unknown as FilaCliente[], total: count ?? 0 };
}

export type PedidoDeCliente = {
  id: string;
  number: string;
  status: string;
  currency_code: 'COP' | 'USD';
  total_customer: Monto;
  created_at: string;
};
const COLUMNAS_PEDIDO = 'id, number, status, currency_code, total_customer, created_at';

type ClienteBase = FilaCliente & { document_type: string | null; document_number: string | null; auth_user_id: string | null };

/**
 * Pedidos del cliente: los vinculados por `customer_id` y los de invitado con su mismo celular o correo (se consulta
 * por separado cada campo, sin armar filtros con texto del cliente).
 */
async function pedidosDe(cliente: Cliente, c: Pick<ClienteBase, 'id' | 'email' | 'phone_e164'>): Promise<PedidoDeCliente[]> {
  const consultas = [cliente.from('orders').select(COLUMNAS_PEDIDO).eq('customer_id', c.id).limit(500)];
  if (c.phone_e164) consultas.push(cliente.from('orders').select(COLUMNAS_PEDIDO).eq('contact_phone_e164', c.phone_e164).limit(500));
  if (c.email) consultas.push(cliente.from('orders').select(COLUMNAS_PEDIDO).eq('contact_email', c.email).limit(500));
  const respuestas = await Promise.all(consultas);
  const porId = new Map<string, PedidoDeCliente>();
  for (const r of respuestas) {
    if (r.error) throw new Error(`No se pudieron leer los pedidos del cliente: ${r.error.message}`);
    for (const p of (r.data ?? []) as unknown as PedidoDeCliente[]) porId.set(p.id, p);
  }
  return [...porId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function garantiasAbiertas(cliente: Cliente, c: Pick<ClienteBase, 'email' | 'phone_e164'>): Promise<number> {
  const estados = [...ESTADOS_GARANTIA_ABIERTOS];
  const consultas = [];
  if (c.phone_e164) {
    consultas.push(cliente.from('warranty_claims').select('id', { count: 'exact', head: true }).eq('phone', c.phone_e164).in('status', estados));
  }
  if (c.email) {
    consultas.push(cliente.from('warranty_claims').select('id', { count: 'exact', head: true }).eq('email', c.email).in('status', estados));
  }
  const rs = await Promise.all(consultas);
  return rs.reduce((a, r) => a + (r.count ?? 0), 0);
}

export type DetalleCliente = {
  cliente: ClienteBase;
  pedidos: PedidoDeCliente[];
  direcciones: number;
  bloqueos: string[];
};

export async function obtenerCliente(cliente: Cliente, id: string): Promise<DetalleCliente | null> {
  const { data, error } = await cliente
    .from('customers')
    .select(`${COLUMNAS}, document_type, document_number, auth_user_id`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el cliente: ${error.message}`);
  if (!data) return null;
  const c = data as unknown as ClienteBase;
  const [pedidos, abiertas, dir, panel] = await Promise.all([
    c.anonymized_at ? Promise.resolve([] as PedidoDeCliente[]) : pedidosDe(cliente, c),
    c.anonymized_at ? Promise.resolve(0) : garantiasAbiertas(cliente, c),
    cliente.from('addresses').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    c.auth_user_id
      ? cliente.from('admin_users').select('auth_user_id', { count: 'exact', head: true }).eq('auth_user_id', c.auth_user_id)
      : Promise.resolve({ count: 0 }),
  ]);
  return {
    cliente: c,
    pedidos,
    direcciones: dir.count ?? 0,
    bloqueos: bloqueosAnonimizacion({
      yaAnonimizado: c.anonymized_at !== null,
      pedidosEnCurso: pedidos.filter((p) => pedidoEnCurso(p.status)).length,
      garantiasAbiertas: abiertas,
      esCuentaDelPanel: (panel.count ?? 0) > 0,
    }),
  };
}

const LOTE = 100;
const trozos = <T>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / LOTE) }, (_, i) => xs.slice(i * LOTE, (i + 1) * LOTE));

/**
 * Anonimiza al cliente y sus rastros: pedidos (contacto, documento y dirección; se conservan montos, fechas, estado y
 * ciudad), garantías, mensajes de WhatsApp, direcciones, lista de deseos, conversaciones con Iza, leads y la cuenta de
 * acceso. Irreversible. Se niega si hay pedidos o garantías en curso.
 */
export async function anonimizarClienteBd(args: Ctx & { datos: DatosAnonimizar; ahora?: Date }): Promise<ResultadoAccion> {
  const { cliente, datos, actor, ip } = args;
  const detalle = await obtenerCliente(cliente, datos.id);
  if (!detalle) return { ok: false, mensaje: 'Este cliente ya no existe.' };
  if (detalle.bloqueos.length > 0) return { ok: false, mensaje: detalle.bloqueos.join(' ') };
  const c = detalle.cliente;
  const falla = (paso: string): ResultadoAccion => ({
    ok: false,
    mensaje: `No se pudo terminar (${paso}). El cliente aún no quedó marcado como anonimizado: es seguro intentarlo de nuevo.`,
  });

  const idsPedidos = detalle.pedidos.map((p) => p.id);
  for (const lote of trozos(idsPedidos)) {
    const { error } = await cliente
      .from('orders')
      .update({
        contact_first_name: MARCA_ANONIMIZADO,
        contact_last_name: '',
        contact_phone_e164: MARCA_ANONIMIZADO.toLowerCase(),
        contact_email: null,
        document_type: null,
        document_number: null,
        shipping_district: null,
        shipping_address1: null,
        shipping_address2: null,
        shipping_zip: null,
        shipping_notes: null,
      })
      .in('id', lote);
    if (error) return falla('pedidos');
    const wa = await cliente.from('whatsapp_messages').update({ to_e164: MARCA_ANONIMIZADO.toLowerCase() }).in('order_id', lote);
    if (wa.error) return falla('mensajes de WhatsApp');
  }

  // Garantías y leads que coinciden por celular o correo (consultas separadas, sin filtros armados con texto).
  const claves: [string, string | null][] = [['phone', c.phone_e164], ['email', c.email]];
  for (const [campo, valor] of claves) {
    if (!valor) continue;
    const g = await cliente
      .from('warranty_claims')
      .update({ customer_name: MARCA_ANONIMIZADO, phone: MARCA_ANONIMIZADO.toLowerCase(), email: null, description: null })
      .eq(campo, valor);
    if (g.error) return falla('garantías');
    const l = await cliente.from('leads').delete().eq(campo === 'phone' ? 'phone_e164' : 'email', valor);
    if (l.error) return falla('leads');
  }

  for (const [tabla, columna] of [['addresses', 'customer_id'], ['wishlists', 'customer_id'], ['chat_sessions', 'customer_id']] as const) {
    const { error } = await cliente.from(tabla).delete().eq(columna, c.id);
    if (error) return falla(tabla === 'addresses' ? 'direcciones' : tabla === 'wishlists' ? 'lista de deseos' : 'conversaciones');
  }

  if (c.auth_user_id) {
    const { error } = await cliente.auth.admin.deleteUser(c.auth_user_id);
    if (error) return falla('cuenta de acceso');
  }

  const { error } = await cliente
    .from('customers')
    .update({
      first_name: null,
      last_name: null,
      email: null,
      phone_e164: null,
      document_type: null,
      document_number: null,
      marketing_opt_in: false,
      whatsapp_opt_in: false,
      anonymized_at: (args.ahora ?? new Date()).toISOString(),
    })
    .eq('id', c.id);
  if (error) return falla('ficha del cliente');

  await auditarCambio({
    actor,
    accion: 'clientes.anonimizado',
    entidad: 'customers',
    entidadId: c.id,
    diff: { motivo: datos.motivo, pedidos: idsPedidos.length, direcciones: detalle.direcciones, cuenta_acceso_eliminada: Boolean(c.auth_user_id) },
    ip,
  });
  return { ok: true, id: c.id };
}
