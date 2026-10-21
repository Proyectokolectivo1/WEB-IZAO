/**
 * Lecturas de PostgREST para el polling de MasterShop (llave de servidor). Solo lee: la escritura la hace
 * `carrier.sync`.
 */
import { fromDbAmount } from '@izao/core/money';
import { TERMINAL_STATUSES } from '@izao/core/order-state';
import { parseMasterShopCredentials } from '@izao/mastershop';
import { crearClientePostgrest, eq, ErrorPostgrest, type Fila, type OpcionesPostgrest } from '../postgrest.js';
import type { FuenteBilletera, PedidoBilletera } from './billetera.js';
import type { EnvioAbierto, FuentePolling } from './polling.js';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

export function aEnvioAbierto(r: Fila): EnvioAbierto | null {
  const pid = num(r.provider_order_id);
  if (pid === null) return null;
  return {
    order_id: String(r.order_id),
    external_order_id: String(r.external_order_id),
    provider_order_id: pid,
    provider_status_id: num(r.provider_status_id),
    has_novelty: r.has_novelty === true,
    tracking_code: typeof r.tracking_code === 'string' ? r.tracking_code : null,
    last_synced_at: typeof r.last_synced_at === 'string' ? new Date(r.last_synced_at) : null,
  };
}

const json = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

/**
 * Columnas del saldo en `country_settings` (CO) pedidas a izao-db: `carrier_wallet_low_balance` (umbral, `null` =
 * sin alerta), `carrier_wallet_balance`, `carrier_wallet_balance_at`, `carrier_wallet_low_alert_at`. Mientras no
 * existan (`42703`), el saldo se omite y los costos siguen funcionando.
 */
const COLUMNAS_SALDO = 'carrier_wallet_low_balance,carrier_wallet_low_alert_at';

export function crearFuenteBilleteraPostgrest(o: OpcionesPostgrest): FuenteBilletera {
  const c = crearClientePostgrest(o);
  let categoria: string | null = null;
  return {
    async credenciales() {
      const cred = await c.credencial('mastershop', 'CO', 'billetera');
      return cred ? parseMasterShopCredentials(cred.valores) : null;
    },
    async pedidosPorIdProveedor(ids) {
      const r: PedidoBilletera[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100).filter((x) => Number.isSafeInteger(x) && x > 0);
        if (lote.length === 0) continue;
        const rows = await c.filas(
          'shipments',
          `shipments?provider=eq.mastershop&provider_order_id=in.(${lote.join(',')})&select=order_id,provider_order_id,orders!inner(carrier_fees)`,
        );
        for (const f of rows) {
          const pid = num(f.provider_order_id);
          const ord = f.orders as Fila | null;
          if (pid !== null) r.push({ order_id: String(f.order_id), provider_order_id: pid, carrier_fees: ord?.carrier_fees ?? {} });
        }
      }
      return r;
    },
    async guardarCostos(orderId, real, fees) {
      await c.pedir('orders', `orders?id=${eq(orderId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: json({ shipping_cost_real: real, carrier_fees: fees }),
      });
    },
    async registrarGasto(g) {
      if (categoria === null) {
        const rows = await c.filas('expense_categories', 'expense_categories?slug=eq.mastershop&select=id');
        if (!rows[0]) throw new Error('expense_categories: falta la categoría "mastershop" del seed');
        categoria = String(rows[0].id);
      }
      try {
        await c.pedir('expenses', 'expenses', {
          method: 'POST',
          headers: { prefer: 'return=minimal' },
          body: json({
            country_code: 'CO',
            category_id: categoria,
            date: g.date,
            amount: g.amount,
            currency_code: 'COP',
            description: g.description.slice(0, 300),
            source: 'mastershop_wallet',
            external_ref: g.external_ref,
          }),
        });
        return true;
      } catch (e) {
        if (e instanceof ErrorPostgrest && e.codigo === '23505') return false;
        throw e;
      }
    },
    async estadoSaldo() {
      try {
        const rows = await c.filas('country_settings', `country_settings?country_code=eq.CO&select=${COLUMNAS_SALDO}`);
        const r = rows[0];
        if (!r) return null;
        const u = r.carrier_wallet_low_balance;
        return {
          umbral: u === null || u === undefined ? null : fromDbAmount(u as string | number),
          alertaActiva: typeof r.carrier_wallet_low_alert_at === 'string',
        };
      } catch (e) {
        if (e instanceof ErrorPostgrest && e.codigo === '42703') return null;
        throw e;
      }
    },
    async guardarSaldo(s, activa, ahora) {
      const cuerpo: Record<string, unknown> = {};
      if (s) {
        cuerpo.carrier_wallet_balance = s.valor;
        cuerpo.carrier_wallet_balance_at = s.fecha.toISOString();
      }
      cuerpo.carrier_wallet_low_alert_at = activa ? ahora.toISOString() : null;
      await c.pedir('country_settings', 'country_settings?country_code=eq.CO', {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: json(cuerpo),
      });
    },
  };
}

export function crearFuentePollingPostgrest(o: OpcionesPostgrest): FuentePolling {
  const c = crearClientePostgrest(o);
  return {
    async credenciales() {
      const cred = await c.credencial('mastershop', 'CO', 'polling');
      return cred ? parseMasterShopCredentials(cred.valores) : null;
    },
    async enviosAbiertos() {
      const terminales = TERMINAL_STATUSES.join(',');
      const rows = await c.filas(
        'shipments',
        'shipments?provider=eq.mastershop&provider_order_id=not.is.null' +
          '&select=order_id,external_order_id,provider_order_id,provider_status_id,has_novelty,tracking_code,last_synced_at,orders!inner(status)' +
          `&orders.status=not.in.(${terminales})&limit=5000`,
      );
      return rows.flatMap((r) => {
        const e = aEnvioAbierto(r);
        return e ? [e] : [];
      });
    },
  };
}
