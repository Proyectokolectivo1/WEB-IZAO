/**
 * `FuenteCod` (+ lecturas del barrido) contra Supabase por PostgREST con la llave de servidor (dueño: izao-pagos).
 * Mismo cliente que `payments/fuente-postgrest.ts`: errores sin cuerpo (solo SQLSTATE), credenciales descifradas
 * con `APP_ENCRYPTION_KEY`. Transiciones por `aplicar_transicion_pedido`; stock y canje por sus RPC idempotentes.
 *
 * Idempotencia del envío: `whatsapp_messages_envio_unico_key (order_id, template_id, scheduled_for)` (izao-db,
 * 874fb2e). `prepararMensaje` busca la fila y, si no existe, la inserta; un 23505 (carrera) se resuelve releyendo.
 */
import type { PaymentStatus, StockFunctionResult, StockState } from '@izao/core/contracts';
import { fromDbAmount, toSafeNumber, type CountryCode, type CurrencyCode } from '@izao/core/money';
import type { OrderStatus } from '@izao/core/order-state';
import { leerCredencialesWhatsApp, type PlantillaWhatsApp } from '@izao/whatsapp';
import { parseWompiCredentials } from '@izao/wompi';
import { aplicarTransicionRpc, crearClientePostgrest, eq, ErrorPostgrest, type Fila, type OpcionesPostgrest } from '../postgrest.js';
import {
  PROVEEDORES_SOLICITUD_LOCAL,
  type AbonoFila,
  type FuenteBarrido,
  type FuenteCod,
  type MensajeFila,
  type PayLinkFila,
  type PedidoPorVencer,
  type SolicitudFinanciacionAbierta,
} from './fuente.js';

const COLUMNAS_PEDIDO =
  'id,number,public_token,status,country_code,currency_code,payment_method,stock_state,cod_deposit_amount,cod_collect_amount,' +
  'contact_first_name,contact_email,contact_phone_e164,created_at,stock_reserved_until';
const COLUMNAS_PLANTILLA = 'id,key,meta_template_name,language,body_text,footer_text,button_text,button_url,variables_map';

const fecha = (v: unknown): Date | null => (typeof v === 'string' && v !== '' ? new Date(v) : null);
const esDuplicado = (e: unknown): boolean => e instanceof ErrorPostgrest && e.codigo === '23505';
const insertar = { method: 'POST', headers: { prefer: 'return=representation' } } as const;
const minimo = { prefer: 'return=minimal' } as const;

function aAbono(f: Fila): AbonoFila {
  return {
    id: String(f.id),
    status: f.status as PaymentStatus,
    amount: fromDbAmount(f.amount as string | number),
    provider_reference: (f.provider_reference as string | null) ?? null,
    payment_link_id: (f.payment_link_id as string | null) ?? null,
    checkout_url: (f.checkout_url as string | null) ?? null,
    expires_at: fecha(f.expires_at),
  };
}

export function crearFuenteCodPostgrest(o: OpcionesPostgrest): FuenteCod & FuenteBarrido {
  const c = crearClientePostgrest(o);
  const { pedir, filas } = c;

  async function idMensaje(m: { order_id: string; template_id: string; scheduled_for: Date }): Promise<string | null> {
    const [f] = await filas(
      'whatsapp_messages',
      `whatsapp_messages?order_id=${eq(m.order_id)}&template_id=${eq(m.template_id)}&scheduled_for=${eq(m.scheduled_for.toISOString())}&select=id&limit=1`,
    );
    return f ? String(f.id) : null;
  }

  return {
    async pedido(orderId) {
      const [f] = await filas('orders', `orders?id=${eq(orderId)}&select=${COLUMNAS_PEDIDO}`);
      if (!f) return null;
      return {
        id: String(f.id),
        number: String(f.number),
        public_token: String(f.public_token),
        status: f.status as OrderStatus,
        country_code: f.country_code as CountryCode,
        currency_code: f.currency_code as CurrencyCode,
        payment_method: String(f.payment_method),
        stock_state: f.stock_state as StockState,
        cod_deposit_amount: fromDbAmount(f.cod_deposit_amount as string | number),
        cod_collect_amount: fromDbAmount(f.cod_collect_amount as string | number),
        contact_first_name: String(f.contact_first_name),
        contact_email: (f.contact_email as string | null) ?? null,
        contact_phone_e164: String(f.contact_phone_e164),
        created_at: new Date(String(f.created_at)),
        stock_reserved_until: fecha(f.stock_reserved_until),
      };
    },
    async config(pais) {
      const [f] = await filas(
        'country_settings',
        `country_settings?country_code=${eq(pais)}&select=cod_reminder_offsets_minutes,cod_quiet_hours_start,cod_quiet_hours_end,countries(timezone)`,
      );
      const zona = (f?.countries as { timezone?: unknown } | null | undefined)?.timezone;
      if (!f || typeof zona !== 'string') return null;
      const offsets = Array.isArray(f.cod_reminder_offsets_minutes) ? f.cod_reminder_offsets_minutes.map(Number) : [];
      return {
        offsetsMinutos: offsets.filter((n) => Number.isInteger(n) && n > 0),
        silencio: { inicio: String(f.cod_quiet_hours_start), fin: String(f.cod_quiet_hours_end) },
        zona,
      };
    },
    async credencialesWompi() {
      const cred = await c.credencial('wompi', 'CO', 'cod');
      if (!cred) return null;
      const p = parseWompiCredentials(cred.valores, cred.ambiente);
      if (!p.ok) console.error(`[cod] credenciales de Wompi incompletas: ${p.problemas.map((x) => x.key).join(',')}`);
      return p.ok ? p.credenciales : null;
    },
    async credencialesWhatsApp(pais) {
      const cred = await c.credencial('whatsapp', pais, 'cod');
      if (!cred) return null;
      const r = leerCredencialesWhatsApp(cred.valores);
      if (!r) console.error(`[cod] credenciales de WhatsApp incompletas para ${pais}`);
      return r;
    },
    async abonos(orderId) {
      return (
        await filas(
          'payments',
          `payments?order_id=${eq(orderId)}&provider=eq.wompi&purpose=eq.cod_deposit&order=created_at.asc` +
            '&select=id,status,amount,provider_reference,payment_link_id,checkout_url,expires_at',
        )
      ).map(aAbono);
    },
    async reservarAbono(n) {
      try {
        const r = (await pedir('payments', 'payments?select=id', {
          ...insertar,
          body: JSON.stringify({
            order_id: n.order_id,
            provider: 'wompi',
            purpose: 'cod_deposit',
            amount: toSafeNumber(n.amount),
            currency_code: n.currency_code,
            status: 'created',
            provider_reference: n.provider_reference,
            expires_at: n.expires_at.toISOString(),
          }),
        })) as Fila[] | null;
        const id = r?.[0]?.id;
        if (typeof id !== 'string') throw new Error('payments: inserción sin id');
        return { ok: true, id };
      } catch (e) {
        if (esDuplicado(e)) return { ok: false, motivo: 'duplicado' };
        throw e;
      }
    },
    async guardarLink(paymentId, link) {
      await pedir('payments', `payments?id=${eq(paymentId)}`, {
        method: 'PATCH',
        headers: minimo,
        body: JSON.stringify({ payment_link_id: link.payment_link_id, checkout_url: link.checkout_url }),
      });
    },
    async payLink(orderId) {
      const [f] = await filas(
        'pay_links',
        `pay_links?order_id=${eq(orderId)}&order=created_at.desc&limit=1&select=token,payment_id,target_url,expires_at`,
      );
      if (!f) return null;
      return {
        token: String(f.token),
        payment_id: (f.payment_id as string | null) ?? null,
        target_url: String(f.target_url),
        expires_at: new Date(String(f.expires_at)),
      } satisfies PayLinkFila;
    },
    async crearPayLink(p) {
      try {
        await pedir('pay_links', 'pay_links', {
          method: 'POST',
          headers: minimo,
          body: JSON.stringify({ token: p.token, payment_id: p.payment_id, target_url: p.target_url, expires_at: p.expires_at.toISOString(), order_id: p.order_id }),
        });
        return { ok: true };
      } catch (e) {
        if (esDuplicado(e)) return { ok: false, motivo: 'duplicado' };
        throw e;
      }
    },
    async plantillaActiva(pais, key) {
      const [f] = await filas(
        'whatsapp_templates',
        `whatsapp_templates?country_code=${eq(pais)}&key=${eq(key)}&is_active=is.true&meta_status=eq.approved&select=${COLUMNAS_PLANTILLA}&limit=1`,
      );
      if (!f) return null;
      return {
        id: String(f.id),
        key: String(f.key),
        meta_template_name: String(f.meta_template_name),
        language: String(f.language),
        body_text: String(f.body_text),
        footer_text: (f.footer_text as string | null) ?? null,
        button_text: (f.button_text as string | null) ?? null,
        button_url: (f.button_url as string | null) ?? null,
        variables_map: (f.variables_map ?? {}) as PlantillaWhatsApp['variables_map'],
      };
    },
    async mensajes(orderId) {
      return (
        await filas(
          'whatsapp_messages',
          `whatsapp_messages?order_id=${eq(orderId)}&order=created_at.asc&select=id,scheduled_for,status,wa_message_id,whatsapp_templates(key)`,
        )
      ).map(
        (f): MensajeFila => ({
          id: String(f.id),
          template_key: String((f.whatsapp_templates as { key?: unknown } | null)?.key ?? ''),
          scheduled_for: fecha(f.scheduled_for),
          status: f.status as MensajeFila['status'],
          wa_message_id: (f.wa_message_id as string | null) ?? null,
        }),
      );
    },
    async prepararMensaje(m) {
      const previo = await idMensaje(m);
      if (previo) return previo;
      try {
        const r = (await pedir('whatsapp_messages', 'whatsapp_messages?select=id', {
          ...insertar,
          body: JSON.stringify({ order_id: m.order_id, template_id: m.template_id, to_e164: m.to_e164, scheduled_for: m.scheduled_for.toISOString(), status: 'queued' }),
        })) as Fila[] | null;
        const id = r?.[0]?.id;
        if (typeof id !== 'string') throw new Error('whatsapp_messages: inserción sin id');
        return id;
      } catch (e) {
        if (!esDuplicado(e)) throw e;
        const id = await idMensaje(m);
        if (!id) throw e;
        return id;
      }
    },
    async marcarMensaje(id, r) {
      const cuerpo =
        r.status === 'sent'
          ? { status: 'sent', wa_message_id: r.wa_message_id, sent_at: r.sent_at.toISOString() }
          : { status: 'failed', error_code: r.error_code.slice(0, 40), error_text: r.error_text.slice(0, 300) };
      await pedir('whatsapp_messages', `whatsapp_messages?id=${eq(id)}`, { method: 'PATCH', headers: minimo, body: JSON.stringify(cuerpo) });
    },
    async aplicarTransicion(orderId, evento, fechas = {}) {
      return aplicarTransicionRpc(c, orderId, evento, { abandoned_at: fechas.abandoned_at });
    },
    async liberarStock(orderId) {
      return (await c.rpcPedido('liberar_stock', orderId)) as StockFunctionResult;
    },
    async liberarCanje(orderId) {
      return (await c.rpcPedido('liberar_canje', orderId)) as { ok: boolean };
    },
    async registrarAlerta(orderId, motivo, payload) {
      await pedir('order_events', 'order_events', {
        method: 'POST',
        headers: minimo,
        body: JSON.stringify({ order_id: orderId, type: 'alerta', actor: 'system', payload: { motivo, ...payload } }),
      });
    },
    async topeReenvios(pais) {
      try {
        const [f] = await filas('country_settings', `country_settings?country_code=${eq(pais)}&select=cod_resend_max`);
        const n = f?.cod_resend_max;
        return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
      } catch (e) {
        // 42703: la columna aún no existe (migración pendiente de izao-db) → sin tope configurado.
        if (e instanceof ErrorPostgrest && e.codigo === '42703') return null;
        throw e;
      }
    },

    async pedidosPorVencer(ahora, limite) {
      const r = (await pedir('pedidos_por_vencer', 'rpc/pedidos_por_vencer', {
        method: 'POST',
        body: JSON.stringify({ p_ahora: ahora.toISOString(), p_limite: limite }),
      })) as Fila[] | null;
      return (r ?? []).map(
        (f): PedidoPorVencer => ({
          order_id: String(f.order_id),
          estado_actual: f.estado_actual as OrderStatus,
          nuevo_estado: f.nuevo_estado as OrderStatus,
        }),
      );
    },
    async pedidosSinLink(creadosAntes, ahora, limite) {
      return (
        await filas(
          'orders',
          `orders?status=eq.esperando_abono&payment_method=eq.cod&created_at=lt.${encodeURIComponent(creadosAntes.toISOString())}` +
            `&stock_reserved_until=gt.${encodeURIComponent(ahora.toISOString())}&select=id,pay_links(token)&pay_links=is.null` +
            `&order=created_at.asc&limit=${limite}`,
        )
      ).map((f) => String(f.id));
    },
    async reservasHuerfanas(limite) {
      return (await filas('orders', `orders?status=in.(expirado,abandonado)&stock_state=eq.reserved&select=id&limit=${limite}`)).map((f) =>
        String(f.id),
      );
    },
    async solicitudesFinanciacionVencidas(limite) {
      const proveedores = PROVEEDORES_SOLICITUD_LOCAL.join(',');
      return (
        await filas(
          'payments',
          `payments?provider=in.(${proveedores})&purpose=eq.financing&status=in.(created,pending)` +
            `&select=id,order_id,provider,orders!inner(status)&orders.status=eq.expirado&order=created_at.asc&limit=${limite}`,
        )
      )
        .filter((f) => (PROVEEDORES_SOLICITUD_LOCAL as readonly unknown[]).includes(f.provider))
        .map(
          (f): SolicitudFinanciacionAbierta => ({
            payment_id: String(f.id),
            order_id: String(f.order_id),
            provider: f.provider as SolicitudFinanciacionAbierta['provider'],
          }),
        );
    },
    async invalidarSolicitudFinanciacion(paymentId) {
      const r = (await pedir('payments', `payments?id=${eq(paymentId)}&status=in.(created,pending)&select=id`, {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({ status: 'expired' satisfies PaymentStatus }),
      })) as Fila[] | null;
      return (r ?? []).length > 0;
    },
  };
}

