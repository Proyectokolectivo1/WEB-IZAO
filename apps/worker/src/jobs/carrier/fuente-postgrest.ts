/**
 * `FuenteCarrier` contra Supabase por PostgREST con la llave de servidor (dueño: izao-logistica).
 * Credencial de MasterShop: `integration_credentials` activa de `mastershop`/CO, descifrada con
 * `@izao/core/credentials` (vía `ClientePostgrest.credencial`). Nunca se registran llaves ni respuestas.
 */
import type { Order, OrderItem } from '@izao/core/contracts';
import { fromDbAmount, type CountryCode, type CurrencyCode } from '@izao/core/money';
import type { OrderStatus } from '@izao/core/order-state';
import { parseMasterShopCredentials, type CarrierDiscountMode } from '@izao/mastershop';
import { aplicarTransicionRpc, crearClientePostgrest, eq, ErrorPostgrest, type Fila, type OpcionesPostgrest } from '../postgrest.js';
import type { CambiosEnvio, EnvioFila, FuenteCarrier } from './fuente.js';

const json = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

const txt = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const monto = (v: unknown): bigint => fromDbAmount(v as string | number);
const fecha = (v: unknown): Date | null => (typeof v === 'string' ? new Date(v) : null);

/** `numeric(5,2)` como texto decimal exacto (PostgREST lo devuelve como número JSON). */
function decimal2(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
  return '0.00';
}

function aItem(r: Fila): OrderItem {
  return {
    id: String(r.id),
    order_id: String(r.order_id),
    product_id: txt(r.product_id),
    variant_id: txt(r.variant_id),
    sku: String(r.sku),
    name_snapshot: String(r.name_snapshot),
    variant_label: txt(r.variant_label),
    quantity: Number(r.quantity),
    unit_price: monto(r.unit_price),
    unit_compare_at: r.unit_compare_at === null ? null : monto(r.unit_compare_at),
    unit_cost: r.unit_cost === null ? null : monto(r.unit_cost),
    line_discount: monto(r.line_discount ?? 0),
    weight_kg: num(r.weight_kg),
    mastershop_product_id: num(r.mastershop_product_id),
    mastershop_variant_id: num(r.mastershop_variant_id),
  };
}

export function filaAPedido(r: Fila): Order {
  const items = Array.isArray(r.order_items) ? (r.order_items as Fila[]).map(aItem) : [];
  return {
    id: String(r.id),
    number: String(r.number),
    country_code: r.country_code as CountryCode,
    currency_code: r.currency_code as CurrencyCode,
    customer_id: txt(r.customer_id),
    status: r.status as OrderStatus,
    payment_method: r.payment_method as Order['payment_method'],
    contact_first_name: String(r.contact_first_name),
    contact_last_name: String(r.contact_last_name),
    contact_phone_e164: String(r.contact_phone_e164),
    contact_email: txt(r.contact_email),
    document_type: txt(r.document_type),
    document_number: txt(r.document_number),
    shipping_region_id: txt(r.shipping_region_id),
    shipping_city_id: txt(r.shipping_city_id),
    shipping_region_name: txt(r.shipping_region_name),
    shipping_city_name: txt(r.shipping_city_name),
    shipping_district: txt(r.shipping_district),
    shipping_address1: txt(r.shipping_address1),
    shipping_address2: txt(r.shipping_address2),
    shipping_zip: txt(r.shipping_zip),
    shipping_notes: txt(r.shipping_notes),
    subtotal: monto(r.subtotal),
    discount_code_id: txt(r.discount_code_id),
    discount_amount: monto(r.discount_amount),
    financing_surcharge_pct: decimal2(r.financing_surcharge_pct),
    financing_surcharge_amount: monto(r.financing_surcharge_amount),
    total_customer: monto(r.total_customer),
    cod_deposit_amount: monto(r.cod_deposit_amount),
    cod_collect_amount: monto(r.cod_collect_amount),
    discount_code_text: txt(r.discount_code_text),
    terms_accepted_at: fecha(r.terms_accepted_at),
    data_policy_version: txt(r.data_policy_version),
    whatsapp_opt_in: r.whatsapp_opt_in === true,
    public_token: String(r.public_token),
    stock_state: r.stock_state as Order['stock_state'],
    stock_reserved_until: fecha(r.stock_reserved_until),
    paid_at: fecha(r.paid_at),
    created_at: fecha(r.created_at) ?? new Date(0),
    items,
  };
}

const COLUMNAS_ENVIO = 'id,order_id,external_order_id,provider_order_id,provider_status_id,tracking_code,label_url,label_local_path';

function aEnvio(r: Fila): EnvioFila {
  return {
    id: String(r.id),
    order_id: String(r.order_id),
    external_order_id: String(r.external_order_id),
    provider_order_id: num(r.provider_order_id),
    provider_status_id: num(r.provider_status_id),
    tracking_code: txt(r.tracking_code),
    label_url: txt(r.label_url),
    label_local_path: txt(r.label_local_path),
  };
}

const MODOS: ReadonlySet<string> = new Set(['additional_charge', 'prorate']);

export function crearFuenteCarrierPostgrest(o: OpcionesPostgrest): FuenteCarrier {
  const c = crearClientePostgrest(o);
  const { pedir, filas } = c;

  return {
    async pedido(id) {
      const rows = await filas('orders', `orders?id=${eq(id)}&select=*,order_items(*)`);
      return rows[0] ? filaAPedido(rows[0]) : null;
    },
    async pedidoPorNumero(numero) {
      const rows = await filas('orders', `orders?number=${eq(numero)}&country_code=eq.CO&select=id`);
      return rows.length === 1 ? String(rows[0]!.id) : null;
    },
    async pedidoPorIdProveedor(pid) {
      const rows = await filas('shipments', `shipments?provider=eq.mastershop&provider_order_id=eq.${pid}&select=order_id`);
      return rows.length === 1 ? String(rows[0]!.order_id) : null;
    },
    async ajustes(pais) {
      const rows = await filas(
        'country_settings',
        `country_settings?country_code=${eq(pais)}&select=carrier_provider,carrier_auto_confirm,carrier_discount_mode`,
      );
      const r = rows[0];
      if (!r) return null;
      const modo = String(r.carrier_discount_mode);
      return {
        proveedor: r.carrier_provider === 'mastershop' ? 'mastershop' : null,
        autoConfirmar: r.carrier_auto_confirm !== false,
        modo: (MODOS.has(modo) ? modo : 'prorate') as CarrierDiscountMode,
      };
    },
    async pagoAprobado(id) {
      const rows = await filas(
        'payments',
        `payments?order_id=${eq(id)}&status=eq.approved&select=provider,provider_reference,provider_transaction_id&order=created_at.desc&limit=1`,
      );
      const r = rows[0];
      if (!r) return null;
      return { provider: String(r.provider), referencia: txt(r.provider_transaction_id) ?? txt(r.provider_reference) };
    },
    async credenciales() {
      const cred = await c.credencial('mastershop', 'CO', 'carrier');
      return cred ? parseMasterShopCredentials(cred.valores) : null;
    },
    async envio(id) {
      const rows = await filas('shipments', `shipments?order_id=${eq(id)}&provider=eq.mastershop&select=${COLUMNAS_ENVIO}`);
      return rows[0] ? aEnvio(rows[0]) : null;
    },
    async guardarEnvio(id, cambios: CambiosEnvio) {
      const { historial, last_synced_at, ...resto } = cambios;
      const cuerpo: Record<string, unknown> = { order_id: id, provider: 'mastershop' };
      for (const [k, v] of Object.entries(resto)) if (v !== undefined) cuerpo[k] = v;
      if (last_synced_at) cuerpo.last_synced_at = last_synced_at.toISOString();
      if (historial) {
        const previo = await filas('shipments', `shipments?order_id=${eq(id)}&provider=eq.mastershop&select=status_history`);
        const lista = Array.isArray(previo[0]?.status_history) ? (previo[0]!.status_history as unknown[]) : [];
        cuerpo.status_history = [...lista, historial].slice(-100);
      }
      const r = (await pedir('shipments', `shipments?on_conflict=order_id,provider&select=${COLUMNAS_ENVIO}`, {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: json(cuerpo),
      })) as Fila[] | null;
      if (!r?.[0]) throw new Error('shipments: sin fila tras guardar');
      return aEnvio(r[0]);
    },
    async aplicarTransicion(id, evento, fechas = {}) {
      return aplicarTransicionRpc(c, id, evento, fechas);
    },
    async registrarEvento(id, tipo, actor, payload) {
      await pedir('order_events', 'order_events', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: json({ order_id: id, type: tipo, actor, payload }),
      });
    },
    async crearImpresionEtiqueta(id, shipmentId) {
      const ya = await filas(
        'print_jobs',
        `print_jobs?shipment_id=${eq(shipmentId)}&type=eq.label&requested_by=eq.auto&status=neq.cancelled&select=id&limit=1`,
      );
      if (ya.length > 0) return false;
      try {
        await pedir('print_jobs', 'print_jobs', {
          method: 'POST',
          headers: { prefer: 'return=minimal' },
          body: json({ order_id: id, shipment_id: shipmentId, type: 'label', requested_by: 'auto' }),
        });
      } catch (e) {
        // `print_jobs_etiqueta_auto_unica_key`: otro proceso (poll_label / sync) la creó entre la lectura y el insert.
        if (e instanceof ErrorPostgrest && e.codigo === '23505') return false;
        throw e;
      }
      return true;
    },
    async marcarWebhook(eventId, r) {
      const cuerpo = r.ok ? { processed_at: new Date().toISOString(), error: null } : { error: r.error.slice(0, 200) };
      await pedir('webhook_events', `webhook_events?provider=eq.mastershop&event_id=${eq(eventId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: json(cuerpo),
      });
    },
  };
}
