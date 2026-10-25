/**
 * `FuentePagosAddi` sobre Supabase con el cliente de servicio (SOLO SERVIDOR). Montos `bigint` (la base guarda
 * `bigint`; se validan con `amountSchema`). Las credenciales se descifran en `fuente-pagos-supabase.ts` y nunca
 * salen del servidor; los errores de Addi se guardan solo como código en `raw_last_event`.
 */
import 'server-only';
import { z } from 'zod';
import { toSafeNumber } from '@izao/core/money';
import { ORDER_STATUSES } from '@izao/core/order-state';
import { amountSchema, countryCodeSchema, currencyCodeSchema } from '@izao/core/schemas';
import { ErrorDb, clienteDb } from '@/lib/db/cliente';
import { credencialesAddiActivas, fuentePagosSupabase } from './fuente-pagos-supabase';
import type { FuentePagosAddi, IntentoAddi, PedidoAddiParaPago } from './pago-addi';

const filaItem = z.object({
  sku: z.string(),
  name_snapshot: z.string(),
  variant_label: z.string().nullable(),
  quantity: z.number().int().positive(),
  unit_price: amountSchema,
  line_discount: amountSchema,
});

const filaPedido = z.object({
  id: z.guid(),
  number: z.string(),
  public_token: z.string(),
  status: z.enum(ORDER_STATUSES),
  payment_method: z.string(),
  country_code: countryCodeSchema,
  currency_code: currencyCodeSchema,
  subtotal: amountSchema,
  discount_amount: amountSchema,
  financing_surcharge_amount: amountSchema,
  total_customer: amountSchema,
  contact_first_name: z.string(),
  contact_last_name: z.string(),
  contact_email: z.string().nullable(),
  contact_phone_e164: z.string(),
  document_type: z.string().nullable(),
  document_number: z.string().nullable(),
  shipping_address1: z.string().nullable(),
  shipping_address2: z.string().nullable(),
  shipping_city_name: z.string().nullable(),
  stock_reserved_until: z.string().nullable(),
  order_items: z.array(filaItem),
});
export const COLUMNAS_PEDIDO_ADDI =
  'id,number,public_token,status,payment_method,country_code,currency_code,subtotal,discount_amount,financing_surcharge_amount,total_customer,contact_first_name,contact_last_name,contact_email,contact_phone_e164,document_type,document_number,shipping_address1,shipping_address2,shipping_city_name,stock_reserved_until,order_items(sku,name_snapshot,variant_label,quantity,unit_price,line_discount)';

const filaPago = z.object({
  id: z.guid(),
  status: z.enum(['created', 'pending', 'approved', 'declined', 'voided', 'error', 'expired']),
  amount: amountSchema,
  provider_reference: z.string().nullable(),
  checkout_url: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
const COLUMNAS_PAGO = 'id,status,amount,provider_reference,checkout_url,expires_at,created_at';

export function aPedidoAddi(f: unknown): PedidoAddiParaPago {
  const { order_items, stock_reserved_until, ...p } = filaPedido.parse(f);
  return {
    ...p,
    stock_reserved_until: stock_reserved_until ? new Date(stock_reserved_until) : null,
    // Orden estable: la suma no depende del orden, pero la solicitud sí debe ser reproducible.
    items: order_items
      .map((i) => ({
        sku: i.sku,
        name: i.name_snapshot,
        variant_label: i.variant_label,
        quantity: i.quantity,
        unit_price: i.unit_price,
        line_discount: i.line_discount,
      }))
      .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)),
  };
}

function aIntento(f: unknown): IntentoAddi {
  const p = filaPago.parse(f);
  return { ...p, expires_at: p.expires_at ? new Date(p.expires_at) : null, created_at: new Date(p.created_at) };
}

function fallo(tabla: string, error: { code?: string } | null): never {
  throw new ErrorDb(tabla, 'rpc', 'consulta fallida', error?.code ?? null);
}

export const fuenteAddiSupabase: FuentePagosAddi = {
  async pedidoAddiPorId(id) {
    const { data, error } = await clienteDb().from('orders').select(COLUMNAS_PEDIDO_ADDI).eq('id', id).maybeSingle();
    if (error) fallo('orders', error);
    return data ? aPedidoAddi(data) : null;
  },
  async intentosAddi(orderId) {
    const { data, error } = await clienteDb()
      .from('payments')
      .select(COLUMNAS_PAGO)
      .eq('order_id', orderId)
      .eq('provider', 'addi')
      .eq('purpose', 'financing')
      .order('created_at', { ascending: true });
    if (error) fallo('payments', error);
    return (data ?? []).map(aIntento);
  },
  credencialesAddi: credencialesAddiActivas,
  async insertarIntentoAddi(n) {
    const { data, error } = await clienteDb()
      .from('payments')
      .insert({
        order_id: n.order_id,
        provider: 'addi',
        purpose: 'financing',
        amount: toSafeNumber(n.amount),
        currency_code: n.currency_code,
        status: 'created',
        provider_reference: n.provider_reference,
        expires_at: n.expires_at.toISOString(),
      })
      .select(COLUMNAS_PAGO)
      .single();
    if (error?.code === '23505') return { ok: false, motivo: 'duplicado' };
    if (error || !data) fallo('payments', error);
    return { ok: true, intento: aIntento(data) };
  },
  async completarIntentoAddi(id, c) {
    const { error } = await clienteDb()
      .from('payments')
      .update({
        status: c.status,
        checkout_url: c.checkout_url,
        ...(c.error ? { raw_last_event: { origen: 'crear_solicitud', error: c.error } } : {}),
      })
      .eq('id', id)
      .eq('provider', 'addi')
      // Solo un intento aún `created`: nunca pisa lo que ya escribió un callback (pendiente o aprobado).
      .eq('status', 'created');
    if (error) fallo('payments', error);
  },
  aplicarTransicion: fuentePagosSupabase.aplicarTransicion,
};
