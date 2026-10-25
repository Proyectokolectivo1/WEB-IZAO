/**
 * `FuentePagosWorker` contra Supabase por PostgREST con la llave de servidor (igual que `purgar-audit-log`).
 * Credenciales: `integration_credentials` activa de `wompi`/`CO`, descifrada con `APP_ENCRYPTION_KEY`
 * (`@izao/core/credentials`). Nunca se registran llaves, secretos ni cuerpos de respuesta.
 *
 * `aplicarTransicion` llama `aplicar_transicion_pedido` (izao-db): update condicional por estado y evento
 * `status_changed` en una sola transacción. La legalidad la decide antes `transicionar` de core.
 */
import type { ConfirmRedemptionResult, PaymentPurpose, PaymentStatus, StockFunctionResult } from '@izao/core/contracts';
import { fromDbAmount, toSafeNumber, type CountryCode, type CurrencyCode } from '@izao/core/money';
import type { OrderStatus } from '@izao/core/order-state';
import type { StockState } from '@izao/core/contracts';
import { parseWompiCredentials } from '@izao/wompi';
import {
  aplicarTransicionRpc,
  crearClientePostgrest,
  eq,
  type ClientePostgrest,
  type Fila,
  type OpcionesPostgrest,
} from '../postgrest.js';
import type { FuenteFinanciacionWorker, FuentePagosWorker, PagoFila } from './fuente.js';

export { ErrorPostgrest, interpretarTransicion, type OpcionesPostgrest } from '../postgrest.js';

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

export function crearFuentePostgrest(o: OpcionesPostgrest): FuentePagosWorker {
  const c = crearClientePostgrest(o);
  return {
    ...fuenteDeProveedor(c, 'wompi'),
    async credencialesWompi() {
      const cred = await c.credencial('wompi', 'CO', 'pagos');
      if (!cred) return null;
      const p = parseWompiCredentials(cred.valores, cred.ambiente);
      if (!p.ok) console.error(`[pagos] credenciales de Wompi incompletas: ${p.problemas.map((x) => x.key).join(',')}`);
      return p.ok ? p.credenciales : null;
    },
    async pagosPorLink(linkId) {
      return (
        await c.filas('payments', `payments?provider=eq.wompi&payment_link_id=${eq(linkId)}&order=created_at.asc&select=${COLUMNAS_PAGO}`)
      ).map(aPago);
    },
  };
}

/** Fuente del job `addi.callback`: mismas operaciones filtradas por `provider = addi` (sin credenciales: no reconsulta). */
export function crearFuenteAddiPostgrest(o: OpcionesPostgrest): FuenteFinanciacionWorker {
  return fuenteDeProveedor(crearClientePostgrest(o), 'addi');
}

function fuenteDeProveedor(c: ClientePostgrest, proveedor: 'wompi' | 'addi'): FuenteFinanciacionWorker {
  const { pedir, filas } = c;
  const rpc = (nombre: string, orderId: string) => c.rpcPedido(nombre, orderId);
  const actor = `webhook:${proveedor}`;

  return {
    async pagosPorReferencia(referencia) {
      return (
        await filas('payments', `payments?provider=eq.${proveedor}&provider_reference=${eq(referencia)}&order=created_at.asc&select=${COLUMNAS_PAGO}`)
      ).map(aPago);
    },
    async pagosDelPedido(orderId) {
      return (
        await filas('payments', `payments?provider=eq.${proveedor}&order_id=${eq(orderId)}&order=created_at.asc&select=${COLUMNAS_PAGO}`)
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
      return aplicarTransicionRpc(c, orderId, evento, { paid_at: opciones.paid_at });
    },
    async registrarAlerta(orderId, motivo, payload) {
      await pedir('order_events', 'order_events', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ order_id: orderId, type: 'alerta', actor, payload: { motivo, ...payload } }),
      });
    },
    async marcarWebhook(eventId, r) {
      const cuerpo = r.ok ? { processed_at: new Date().toISOString(), error: null } : { error: r.error.slice(0, 200) };
      await pedir('webhook_events', `webhook_events?provider=eq.${proveedor}&event_id=${eq(eventId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify(cuerpo),
      });
    },
  };
}
