import 'server-only';
/**
 * Lecturas del módulo de pedidos para el panel: lista paginada y detalle (pedido, pagos, mensajes de WhatsApp y
 * línea de tiempo). Solo lectura; cliente inyectado para poder probarlo.
 */
import { formatMoney, money, type CurrencyCode } from '@izao/core/money';
import { urlEtiquetaSegura } from '@izao/mastershop';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { escaparBusqueda, rangoPagina } from '../crud/comun';
import { interpretarBusqueda, rangoFechasUtc, type FiltrosPedido } from './filtros';

export type FilaPedidoLista = {
  id: string;
  number: string;
  country_code: string;
  currency_code: string;
  status: string;
  payment_method: string;
  total_customer: number;
  shipping_city_name: string | null;
  created_at: string;
};

const COLUMNAS_LISTA = 'id, number, country_code, currency_code, status, payment_method, total_customer, shipping_city_name, created_at';

export async function listarPedidos(
  cliente: Cliente,
  f: Pick<FiltrosPedido, 'q' | 'pagina' | 'estado' | 'pais' | 'metodo' | 'desde' | 'hasta'> & Partial<Pick<FiltrosPedido, 'guia' | 'grupo' | 'novedad'>>,
): Promise<{ filas: FilaPedidoLista[]; total: number }> {
  // Con filtro de guía o novedad se une `shipments` (join interno): solo quedan pedidos con envío.
  const conEnvio = Boolean(f.guia || f.grupo || f.novedad);
  let consulta = cliente
    .from('orders')
    .select(conEnvio ? `${COLUMNAS_LISTA}, shipments!inner(provider_status_name)` : COLUMNAS_LISTA, { count: 'exact' });
  if (f.guia) consulta = consulta.eq('shipments.provider_status_name', f.guia);
  if (f.grupo) consulta = consulta.eq('shipments.provider_status_parent', f.grupo);
  if (f.novedad) consulta = consulta.eq('shipments.has_novelty', true);
  const busqueda = interpretarBusqueda(f.q);
  if (busqueda) consulta = consulta.ilike(busqueda.campo, `%${escaparBusqueda(busqueda.patron)}%`);
  if (f.estado) consulta = consulta.eq('status', f.estado);
  if (f.pais) consulta = consulta.eq('country_code', f.pais);
  if (f.metodo) consulta = consulta.eq('payment_method', f.metodo);
  const rango = rangoFechasUtc(f);
  if (rango.desde) consulta = consulta.gte('created_at', rango.desde);
  if (rango.hasta) consulta = consulta.lt('created_at', rango.hasta);
  const [desde, hasta] = rangoPagina(f.pagina);
  const { data, error, count } = await consulta.order('created_at', { ascending: false }).range(desde, hasta);
  if (error) throw new Error(`No se pudieron listar los pedidos: ${error.message}`);
  return { filas: (data ?? []) as never, total: count ?? 0 };
}

export type DetallePedido = {
  pedido: {
    id: string;
    number: string;
    country_code: string;
    currency_code: string;
    status: string;
    payment_method: string;
    contact_first_name: string;
    contact_last_name: string;
    contact_phone_e164: string;
    contact_email: string | null;
    shipping_city_name: string | null;
    shipping_region_name: string | null;
    shipping_address1: string | null;
    subtotal: number;
    discount_amount: number;
    financing_surcharge_amount: number;
    total_customer: number;
    cod_deposit_amount: number;
    cod_collect_amount: number;
    stock_reserved_until: string | null;
    alerts: unknown;
    created_at: string;
    paid_at: string | null;
  };
  pagos: { id: string; provider: string; purpose: string; amount: number; status: string; provider_reference: string | null; created_at: string }[];
  link: { expires_at: string; clicks: number; created_at: string } | null;
  mensajes: {
    id: string;
    status: string;
    error_code: string | null;
    scheduled_for: string | null;
    sent_at: string | null;
    created_at: string;
    whatsapp_templates: { key: string; version: number } | null;
  }[];
  eventos: {
    id: string;
    type: string;
    from_status: string | null;
    to_status: string | null;
    actor: string;
    created_at: string;
    /** Solo trae el texto en las notas internas; en los demás eventos siempre es `null`. */
    nota: string | null;
  }[];
  envio: {
    id: string;
    carrier_name: string | null;
    tracking_code: string | null;
    tracking_url: string | null;
    provider_status_name: string | null;
    has_novelty: boolean;
    etiqueta_lista: boolean;
    /** Enlace a la etiqueta en MasterShop (D-051): solo si aún no hay copia local y la URL pasa `urlEtiquetaSegura`. */
    etiqueta_url: string | null;
  } | null;
  impresiones: { id: string; type: string; status: string; requested_by: string; attempts: number; error: string | null; created_at: string; printed_at: string | null }[];
};

function ok<T>(r: { data: unknown; error: { message: string } | null }, que: string): T {
  if (r.error) throw new Error(`No se pudo leer ${que}.`);
  return (r.data ?? []) as T;
}

function textoDeNota(payload: unknown): string | null {
  const t = (payload as { texto?: unknown } | null)?.texto;
  return typeof t === 'string' ? t : null;
}

function envioPublico(f: Record<string, unknown> | undefined): DetallePedido['envio'] {
  if (!f) return null;
  const texto = (v: unknown) => (typeof v === 'string' ? v : null);
  const etiqueta_lista = typeof f.label_local_path === 'string' && f.label_local_path !== '';
  return {
    id: String(f.id),
    carrier_name: texto(f.carrier_name),
    tracking_code: texto(f.tracking_code),
    tracking_url: texto(f.tracking_url),
    provider_status_name: texto(f.provider_status_name),
    has_novelty: f.has_novelty === true,
    etiqueta_lista,
    etiqueta_url: etiqueta_lista ? null : urlEtiquetaSegura(f.label_url),
  };
}

/** Detalle completo. El token del link NO se lee aquí: solo sale por `linkCobroBd`. */
export async function obtenerDetallePedido(cliente: Cliente, id: string): Promise<DetallePedido | null> {
  const { data: pedido, error } = await cliente
    .from('orders')
    .select(
      'id, number, country_code, currency_code, status, payment_method, contact_first_name, contact_last_name, contact_phone_e164, contact_email, shipping_city_name, shipping_region_name, shipping_address1, subtotal, discount_amount, financing_surcharge_amount, total_customer, cod_deposit_amount, cod_collect_amount, stock_reserved_until, alerts, created_at, paid_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('No se pudo leer el pedido.');
  if (!pedido) return null;

  const [pagos, links, mensajes, eventos, envios, impresiones] = await Promise.all([
    cliente
      .from('payments')
      .select('id, provider, purpose, amount, status, provider_reference, created_at')
      .eq('order_id', id)
      .order('created_at', { ascending: true }),
    cliente.from('pay_links').select('expires_at, clicks, created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(1),
    cliente
      .from('whatsapp_messages')
      .select('id, status, error_code, scheduled_for, sent_at, created_at, whatsapp_templates(key, version)')
      .eq('order_id', id)
      .order('created_at', { ascending: true }),
    cliente
      .from('order_events')
      .select('id, type, from_status, to_status, actor, created_at, payload')
      .eq('order_id', id)
      .order('created_at', { ascending: true }),
    cliente
      .from('shipments')
      .select('id, carrier_name, tracking_code, tracking_url, provider_status_name, has_novelty, label_local_path, label_url')
      .eq('order_id', id)
      .limit(1),
    cliente
      .from('print_jobs')
      .select('id, type, status, requested_by, attempts, error, created_at, printed_at')
      .eq('order_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  const links1 = ok<DetallePedido['link'][]>(links, 'el link de cobro');
  return {
    pedido: pedido as never,
    pagos: ok(pagos, 'los pagos'),
    link: links1[0] ?? null,
    mensajes: ok(mensajes, 'los mensajes'),
    eventos: ok<(DetallePedido['eventos'][number] & { payload?: unknown })[]>(eventos, 'la línea de tiempo').map(({ payload, ...e }) => ({
      ...e,
      nota: e.type === 'nota_interna' ? textoDeNota(payload) : null,
    })),
    envio: envioPublico(ok<Record<string, unknown>[]>(envios, 'el envío')[0]),
    impresiones: ok(impresiones, 'las impresiones'),
  };
}

/** Monto en unidad menor a texto con la moneda del pedido. */
export function dinero(monto: number, moneda: string): string {
  if (!Number.isSafeInteger(monto)) return '—';
  return formatMoney(money(BigInt(monto), moneda as CurrencyCode));
}

