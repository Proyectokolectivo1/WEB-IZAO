import 'server-only';
/**
 * Clientes (§24.1, §26.2) con el cliente de servicio: lista, detalle con pedidos y anonimización por habeas data.
 *
 * La anonimización no es una sola transacción (no hay RPC todavía): cada paso es idempotente y la marca
 * `customers.anonymized_at` se escribe al FINAL, así que si algo falla el cliente sigue sin marcar y la acción se puede
 * repetir sin riesgo. Nunca se registra en la auditoría ningún dato personal, ni el anterior ni el nuevo.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import { anonimizarClienteDb, type ResultadoAnonimizar } from '@/lib/db/panel-atomicas';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { escaparBusqueda, rangoPagina, type ResultadoAccion } from '../crud/comun';
import {
  ESTADOS_GARANTIA_ABIERTOS,
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

type Rpc = (id: string) => Promise<ResultadoAnonimizar>;

/**
 * Anonimiza al cliente y sus rastros con la RPC atómica `anonimizar_cliente` (una sola transacción: o queda todo
 * anonimizado o no queda nada). Neutraliza pedidos, garantías, WhatsApp, direcciones, lista de deseos, chat con Iza,
 * leads y la cuenta de acceso, y conserva montos, fechas, estado y ciudad. La RPC se niega con pedidos o garantías en
 * curso o si es una cuenta del panel. El motivo y la auditoría los pone el panel, sin datos personales.
 */
export async function anonimizarClienteBd(args: Ctx & { datos: DatosAnonimizar; rpc?: Rpc }): Promise<ResultadoAccion> {
  const { datos, actor, ip } = args;
  const r = await (args.rpc ?? anonimizarClienteDb)(datos.id);
  if (!r.ok) {
    if (r.motivo === 'bloqueado') {
      return {
        ok: false,
        mensaje: bloqueosAnonimizacion({
          yaAnonimizado: false,
          pedidosEnCurso: r.pedidos_en_curso,
          garantiasAbiertas: r.garantias_abiertas,
          esCuentaDelPanel: r.cuenta_del_panel,
        }).join(' '),
      };
    }
    return {
      ok: false,
      mensaje: r.motivo === 'ya_anonimizado' ? 'Este cliente ya fue anonimizado.' : r.motivo === 'no_existe' ? 'Este cliente ya no existe.' : 'Identificador no válido.',
    };
  }
  await auditarCambio({
    actor,
    accion: 'clientes.anonimizado',
    entidad: 'customers',
    entidadId: r.id,
    diff: {
      motivo: datos.motivo,
      pedidos: r.pedidos,
      garantias: r.garantias,
      leads: r.leads,
      direcciones: r.direcciones,
      conversaciones: r.conversaciones,
      pagos_limpiados: r.pagos_limpiados,
      webhooks_recortados: r.webhooks_recortados,
      resenas: r.resenas,
      fotos_garantia: r.fotos_garantia,
      cuenta_acceso_eliminada: r.cuenta_acceso_eliminada,
    },
    ip,
  });
  return { ok: true, id: r.id };
}
