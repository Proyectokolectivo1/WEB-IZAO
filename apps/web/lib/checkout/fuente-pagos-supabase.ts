/**
 * `FuentePagos` y credenciales de Wompi sobre Supabase con el cliente de servicio (SOLO SERVIDOR).
 * Las credenciales se descifran con `APP_ENCRYPTION_KEY` (`@izao/core/credentials`) y nunca salen de aquí:
 * ni al navegador ni a logs (solo el nombre del error).
 */
import 'server-only';
import { z } from 'zod';
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import { toSafeNumber, type CountryCode } from '@izao/core/money';
import { ORDER_STATUSES } from '@izao/core/order-state';
import { amountSchema, countryCodeSchema, currencyCodeSchema } from '@izao/core/schemas';
import { parseWompiCredentials, type WompiCredentials } from '@izao/wompi';
import { ErrorDb, clienteDb } from '@/lib/db/cliente';
import type { FuentePagos, IntentoPago, PedidoParaPago } from './pago-wompi';

const filaPedido = z.object({
  id: z.guid(),
  number: z.string(),
  public_token: z.string(),
  status: z.enum(ORDER_STATUSES),
  country_code: countryCodeSchema,
  currency_code: currencyCodeSchema,
  payment_method: z.string(),
  total_customer: amountSchema,
  contact_first_name: z.string(),
  contact_last_name: z.string(),
  contact_email: z.string().nullable(),
  contact_phone_e164: z.string(),
  stock_reserved_until: z.string().nullable(),
});
const COLUMNAS_PEDIDO =
  'id,number,public_token,status,country_code,currency_code,payment_method,total_customer,contact_first_name,contact_last_name,contact_email,contact_phone_e164,stock_reserved_until';

const filaPago = z.object({
  id: z.guid(),
  status: z.enum(['created', 'pending', 'approved', 'declined', 'voided', 'error', 'expired']),
  purpose: z.enum(['full', 'cod_deposit', 'financing']),
  amount: amountSchema,
  provider_reference: z.string().nullable(),
  checkout_url: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
const COLUMNAS_PAGO = 'id,status,purpose,amount,provider_reference,checkout_url,expires_at,created_at';

function aPedido(f: unknown): PedidoParaPago {
  const p = filaPedido.parse(f);
  return { ...p, stock_reserved_until: p.stock_reserved_until ? new Date(p.stock_reserved_until) : null };
}

function aIntento(f: unknown): IntentoPago {
  const p = filaPago.parse(f);
  return { ...p, expires_at: p.expires_at ? new Date(p.expires_at) : null, created_at: new Date(p.created_at) };
}

function fallo(tabla: string, error: { code?: string } | null): never {
  throw new ErrorDb(tabla, 'rpc', 'consulta fallida', error?.code ?? null);
}

/** Credencial activa de Wompi para CO, descifrada y validada contra su ambiente. `null` si no hay o no sirve. */
export async function credencialesWompiActivas(): Promise<WompiCredentials | null> {
  const clave = process.env.APP_ENCRYPTION_KEY;
  if (!clave) return null;
  const { data, error } = await clienteDb()
    .from('integration_credentials')
    .select('environment,data_encrypted,iv,key_version')
    .eq('provider', 'wompi')
    .eq('country_code', 'CO')
    .eq('is_active', true);
  if (error) fallo('integration_credentials', error);
  if (!data || data.length !== 1) {
    if (data && data.length > 1) console.error('[pagos] hay más de una credencial activa de Wompi para CO');
    return null;
  }
  const r = data[0] as Record<string, unknown>;
  const ambiente = r.environment === 'production' ? 'production' : 'sandbox';
  try {
    const valores = await descifrarCredenciales(
      clave,
      { provider: 'wompi', country_code: 'CO', environment: ambiente },
      {
        data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)),
        iv: byteaDesdePostgrest(String(r.iv)),
        key_version: Number(r.key_version),
      },
    );
    const p = parseWompiCredentials(valores, ambiente);
    return p.ok ? p.credenciales : null;
  } catch (e) {
    console.error(`[pagos] credenciales de Wompi ilegibles: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}

export const fuentePagosSupabase: FuentePagos = {
  async pedidoPorId(id) {
    const { data, error } = await clienteDb().from('orders').select(COLUMNAS_PEDIDO).eq('id', id).maybeSingle();
    if (error) fallo('orders', error);
    return data ? aPedido(data) : null;
  },
  async pedidoPorToken(pais: CountryCode, token) {
    const { data, error } = await clienteDb()
      .from('orders')
      .select(COLUMNAS_PEDIDO)
      .eq('public_token', token)
      .eq('country_code', pais)
      .maybeSingle();
    if (error) fallo('orders', error);
    return data ? aPedido(data) : null;
  },
  async intentosWompi(orderId) {
    const { data, error } = await clienteDb()
      .from('payments')
      .select(COLUMNAS_PAGO)
      .eq('order_id', orderId)
      .eq('provider', 'wompi')
      .order('created_at', { ascending: true });
    if (error) fallo('payments', error);
    return (data ?? []).map(aIntento);
  },
  credencialesWompi: credencialesWompiActivas,
  async insertarIntento(n) {
    const { data, error } = await clienteDb()
      .from('payments')
      .insert({
        order_id: n.order_id,
        provider: 'wompi',
        purpose: 'full',
        amount: toSafeNumber(n.amount),
        currency_code: n.currency_code,
        status: 'created',
        provider_reference: n.provider_reference,
        checkout_url: n.checkout_url,
        expires_at: n.expires_at.toISOString(),
      })
      .select(COLUMNAS_PAGO)
      .single();
    if (error?.code === '23505') return { ok: false, motivo: 'duplicado' };
    if (error || !data) fallo('payments', error);
    return { ok: true, intento: aIntento(data) };
  },
  async aplicarTransicion(orderId, evento) {
    const db = clienteDb();
    const { data, error } = await db
      .from('orders')
      .update({ status: evento.to_status })
      .eq('id', orderId)
      .eq('status', evento.from_status)
      .select('id');
    if (error) fallo('orders', error);
    if (!data || data.length !== 1) return false;
    const ev = await db.from('order_events').insert({
      order_id: orderId,
      type: evento.type,
      from_status: evento.from_status,
      to_status: evento.to_status,
      actor: evento.actor,
      payload: evento.payload,
    });
    if (ev.error) fallo('order_events', ev.error);
    return true;
  },
};
