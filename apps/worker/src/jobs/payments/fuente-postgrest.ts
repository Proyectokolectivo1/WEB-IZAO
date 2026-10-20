/**
 * `FuentePagosWorker` contra Supabase por PostgREST con la llave de servidor (igual que `purgar-audit-log`).
 * Credenciales: `integration_credentials` activa de `wompi`/`CO`, descifrada con `APP_ENCRYPTION_KEY`
 * (`@izao/core/credentials`). Nunca se registran llaves, secretos ni cuerpos de respuesta.
 *
 * `aplicarTransicion` llama `aplicar_transicion_pedido` (izao-db): update condicional por estado y evento
 * `status_changed` en una sola transacción. La legalidad la decide antes `transicionar` de core.
 */
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import type { ConfirmRedemptionResult, PaymentPurpose, PaymentStatus, StockFunctionResult } from '@izao/core/contracts';
import { fromDbAmount, toSafeNumber, type CountryCode, type CurrencyCode } from '@izao/core/money';
import type { OrderStatus } from '@izao/core/order-state';
import type { StockState } from '@izao/core/contracts';
import { parseWompiCredentials } from '@izao/wompi';
import type { FuentePagosWorker, PagoFila } from './fuente.js';

export interface OpcionesPostgrest {
  supabaseUrl: string;
  secretKey: string;
  claveCifrado: string;
  fetchImpl?: typeof fetch;
}

export class ErrorPostgrest extends Error {
  constructor(operacion: string, status: number) {
    super(`PostgREST ${operacion} respondió HTTP ${status}`);
    this.name = 'ErrorPostgrest';
  }
}

type Fila = Record<string, unknown>;
const COLUMNAS_PAGO =
  'id,order_id,provider,purpose,amount,currency_code,status,provider_reference,provider_transaction_id,payment_link_id,created_at';

function aPago(f: Fila): PagoFila {
  return {
    id: String(f.id),
    order_id: String(f.order_id),
    provider: String(f.provider),
    purpose: f.purpose as PaymentPurpose,
    amount: fromDbAmount(f.amount as string | number),
    currency_code: f.currency_code as CurrencyCode,
    status: f.status as PaymentStatus,
    provider_reference: (f.provider_reference as string | null) ?? null,
    provider_transaction_id: (f.provider_transaction_id as string | null) ?? null,
    payment_link_id: (f.payment_link_id as string | null) ?? null,
    created_at: String(f.created_at),
  };
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

/**
 * Resultado de `aplicar_transicion_pedido`: `true` si quedó aplicada (o ya lo estaba: `estado_cambiado` con
 * `status_actual = to_status`, p. ej. un reintento), `false` si otro proceso lo movió a otro estado (nada escrito).
 * `pedido_inexistente`, `datos_invalidos` o una forma desconocida lanzan (sin detalles de la base).
 */
export function interpretarTransicion(
  r: { ok?: unknown; motivo?: unknown; status_actual?: unknown; event_id?: unknown } | null,
  to: OrderStatus,
): boolean {
  if (r?.ok === true && typeof r.event_id === 'string') return true;
  if (r?.ok === false && r.motivo === 'estado_cambiado') return r.status_actual === to;
  const motivo = r?.ok === false && typeof r.motivo === 'string' ? r.motivo : 'forma';
  throw new Error(`aplicar_transicion_pedido rechazó: ${motivo.slice(0, 40)}`);
}

export function crearFuentePostgrest(o: OpcionesPostgrest): FuentePagosWorker {
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  const doFetch = o.fetchImpl ?? fetch;
  const cabeceras = {
    apikey: o.secretKey,
    authorization: `Bearer ${o.secretKey}`,
    'content-type': 'application/json',
  };

  async function pedir(operacion: string, ruta: string, init: RequestInit = {}): Promise<unknown> {
    const res = await doFetch(`${base}/${ruta}`, {
      ...init,
      headers: { ...cabeceras, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ErrorPostgrest(operacion, res.status);
    if (res.status === 204) return null;
    const texto = await res.text();
    return texto ? (JSON.parse(texto) as unknown) : null;
  }
  const filas = async (operacion: string, ruta: string) => ((await pedir(operacion, ruta)) as Fila[] | null) ?? [];
  const rpc = (nombre: string, orderId: string) =>
    pedir(nombre, `rpc/${nombre}`, { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) });

  return {
    async credencialesWompi() {
      const rows = await filas(
        'integration_credentials',
        `integration_credentials?provider=eq.wompi&country_code=eq.CO&is_active=is.true&select=environment,data_encrypted,iv,key_version`,
      );
      if (rows.length !== 1) {
        if (rows.length > 1) console.error('[pagos] hay más de una credencial activa de Wompi para CO');
        return null;
      }
      const r = rows[0]!;
      const ambiente = r.environment === 'production' ? 'production' : 'sandbox';
      try {
        const valores = await descifrarCredenciales(
          o.claveCifrado,
          { provider: 'wompi', country_code: 'CO', environment: ambiente },
          {
            data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)),
            iv: byteaDesdePostgrest(String(r.iv)),
            key_version: Number(r.key_version),
          },
        );
        const p = parseWompiCredentials(valores, ambiente);
        if (!p.ok) console.error(`[pagos] credenciales de Wompi incompletas: ${p.problemas.map((x) => x.key).join(',')}`);
        return p.ok ? p.credenciales : null;
      } catch (e) {
        console.error(`[pagos] no se pudieron leer las credenciales de Wompi: ${e instanceof Error ? e.name : 'error'}`);
        return null;
      }
    },
    async pagosPorReferencia(referencia) {
      return (
        await filas('payments', `payments?provider=eq.wompi&provider_reference=${eq(referencia)}&order=created_at.asc&select=${COLUMNAS_PAGO}`)
      ).map(aPago);
    },
    async pagosPorLink(linkId) {
      return (
        await filas('payments', `payments?provider=eq.wompi&payment_link_id=${eq(linkId)}&order=created_at.asc&select=${COLUMNAS_PAGO}`)
      ).map(aPago);
    },
    async pagosDelPedido(orderId) {
      return (
        await filas('payments', `payments?provider=eq.wompi&order_id=${eq(orderId)}&order=created_at.asc&select=${COLUMNAS_PAGO}`)
      ).map(aPago);
    },
    async pedido(orderId) {
      const [f] = await filas(
        'orders',
        `orders?id=${eq(orderId)}&select=id,number,status,country_code,currency_code,payment_method,stock_state`,
      );
      if (!f) return null;
      return {
        id: String(f.id),
        number: String(f.number),
        status: f.status as OrderStatus,
        country_code: f.country_code as CountryCode,
        currency_code: f.currency_code as CurrencyCode,
        payment_method: String(f.payment_method),
        stock_state: f.stock_state as StockState,
      };
    },
    async actualizarPago(id, c) {
      await pedir('payments', `payments?id=${eq(id)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          status: c.status,
          provider_transaction_id: c.provider_transaction_id,
          ...(c.fee_amount === null ? {} : { fee_amount: toSafeNumber(c.fee_amount) }),
          raw_last_event: c.raw_last_event,
        }),
      });
    },
    async comision(pais, metodo) {
      const [f] = await filas(
        'payment_method_settings',
        `payment_method_settings?country_code=${eq(pais)}&method=${eq(metodo)}&select=fee_pct,fee_fixed,fee_tax_pct`,
      );
      if (!f) return null;
      return { fee_pct: f.fee_pct, fee_fixed: fromDbAmount(f.fee_fixed as string | number), fee_tax_pct: f.fee_tax_pct };
    },
    async confirmarStock(orderId) {
      return (await rpc('confirmar_stock', orderId)) as StockFunctionResult;
    },
    async confirmarCanje(orderId) {
      return (await rpc('confirmar_canje', orderId)) as ConfirmRedemptionResult;
    },
    async aplicarTransicion(orderId, evento, opciones = {}) {
      const p: Record<string, unknown> = {
        order_id: orderId,
        from_status: evento.from_status,
        to_status: evento.to_status,
        actor: evento.actor,
        payload: evento.payload,
      };
      if (opciones.paid_at) p.fechas = { paid_at: opciones.paid_at.toISOString() };
      const r = (await pedir('aplicar_transicion_pedido', 'rpc/aplicar_transicion_pedido', {
        method: 'POST',
        body: JSON.stringify({ p }),
      })) as { ok?: unknown; motivo?: unknown; status_actual?: unknown; event_id?: unknown } | null;
      return interpretarTransicion(r, evento.to_status);
    },
    async registrarAlerta(orderId, motivo, payload) {
      await pedir('order_events', 'order_events', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ order_id: orderId, type: 'alerta', actor: 'webhook:wompi', payload: { motivo, ...payload } }),
      });
    },
    async marcarWebhook(eventId, r) {
      const cuerpo = r.ok ? { processed_at: new Date().toISOString(), error: null } : { error: r.error.slice(0, 200) };
      await pedir('webhook_events', `webhook_events?provider=eq.wompi&event_id=${eq(eventId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify(cuerpo),
      });
    },
  };
}
