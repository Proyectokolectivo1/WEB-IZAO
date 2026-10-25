/**
 * Fuente PostgREST de `metrics.recompute_day`. Lee los pedidos atribuidos al día (Bogotá) y país con sus pagos y
 * envíos embebidos, y escribe `daily_sales_stats` con upsert. Índices usados: `orders_country_paid_at_idx` y
 * `orders_country_status_created_idx`. Ningún monto pasa por `float`: los enteros de PostgREST se validan como
 * enteros seguros y se escriben como texto decimal exacto.
 */
import { comisionPasarelaDePagos, inicioDiaBogotaUtc, METODOS_PAGO, sumarDias, type FilaVentasDiarias, type MetodoPago, type PedidoMetrica } from '@izao/core/metrics';
import { currencyForCountry, type CountryCode } from '@izao/core/money';
import { ORDER_STATUSES, type OrderStatus } from '@izao/core/order-state';
import { crearClientePostgrest, eq, type Fila, type OpcionesPostgrest } from '../postgrest.js';
import type { FuenteMetricas } from './recalcular-dia.js';

const SELECT_PEDIDO = [
  'id',
  'country_code',
  'currency_code',
  'payment_method',
  'status',
  'created_at',
  'paid_at',
  'total_customer',
  'discount_amount',
  'financing_surcharge_amount',
  'cod_deposit_amount',
  'cod_collect_amount',
  'product_cost_total',
  'gateway_fee_estimated',
  'shipping_cost_real',
  'carrier_fees',
  'payments(status,fee_amount)',
  'shipments(shipping_rate,created_at)',
].join(',');

function entero(v: unknown, campo: string): bigint {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d{1,18}$/.test(v)) return BigInt(v);
  throw new RangeError(`Valor inválido en ${campo}.`);
}

const enteroONull = (v: unknown, campo: string): bigint | null => (v === null || v === undefined ? null : entero(v, campo));

function instante(v: unknown, campo: string): Date {
  const d = typeof v === 'string' ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Fecha inválida en ${campo}.`);
  return d;
}

function plataforma(carrierFees: unknown): bigint {
  if (typeof carrierFees !== 'object' || carrierFees === null) return 0n;
  const v = (carrierFees as Record<string, unknown>).plataforma;
  return v === undefined || v === null ? 0n : entero(v, 'carrier_fees.plataforma');
}

/** Tarifa del envío más reciente que la tenga. */
function tarifaEnvio(envios: unknown): bigint | null {
  if (!Array.isArray(envios)) return null;
  const conTarifa = (envios as Fila[])
    .filter((e) => e.shipping_rate !== null && e.shipping_rate !== undefined)
    .sort((a, b) => instante(b.created_at, 'shipments.created_at').getTime() - instante(a.created_at, 'shipments.created_at').getTime());
  return conTarifa.length > 0 ? entero(conTarifa[0]!.shipping_rate, 'shipments.shipping_rate') : null;
}

function comision(f: Fila): bigint {
  const pagos = Array.isArray(f.payments) ? (f.payments as Fila[]) : [];
  const aprobados = pagos.filter((p) => p.status === 'approved').map((p) => ({ fee_amount: enteroONull(p.fee_amount, 'payments.fee_amount') }));
  return comisionPasarelaDePagos(aprobados, entero(f.gateway_fee_estimated, 'gateway_fee_estimated'));
}

function aPedido(f: Fila, pais: CountryCode, envioEstimadoPais: bigint): PedidoMetrica {
  if (f.country_code !== pais) throw new RangeError('País inesperado en el pedido.');
  const moneda = currencyForCountry(pais);
  if (f.currency_code !== moneda) throw new RangeError('Moneda inesperada en el pedido.');
  if (!(METODOS_PAGO as readonly unknown[]).includes(f.payment_method)) throw new RangeError('Método de pago desconocido.');
  if (!(ORDER_STATUSES as readonly unknown[]).includes(f.status)) throw new RangeError('Estado de pedido desconocido.');
  return {
    id: String(f.id),
    pais,
    moneda,
    metodo: f.payment_method as MetodoPago,
    estado: f.status as OrderStatus,
    creadoEn: instante(f.created_at, 'created_at'),
    pagadoEn: f.paid_at === null || f.paid_at === undefined ? null : instante(f.paid_at, 'paid_at'),
    total: entero(f.total_customer, 'total_customer'),
    descuento: entero(f.discount_amount, 'discount_amount'),
    recargo: entero(f.financing_surcharge_amount, 'financing_surcharge_amount'),
    abono: entero(f.cod_deposit_amount, 'cod_deposit_amount'),
    recaudo: entero(f.cod_collect_amount, 'cod_collect_amount'),
    costoProducto: entero(f.product_cost_total, 'product_cost_total'),
    comisionPasarela: comision(f),
    comisionPlataforma: plataforma(f.carrier_fees),
    envioReal: enteroONull(f.shipping_cost_real, 'shipping_cost_real'),
    tarifaEnvio: tarifaEnvio(f.shipments),
    envioEstimadoPais,
  };
}

/** Fila lista para PostgREST: `bigint` como texto decimal exacto, conteos como número. */
function filaParaBase(f: FilaVentasDiarias, ahora: Date): Record<string, string | number> {
  const out: Record<string, string | number> = { recalculated_at: ahora.toISOString() };
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === 'bigint' ? v.toString() : (v as string | number);
  return out;
}

export function crearFuenteMetricasPostgrest(o: OpcionesPostgrest & { tamanoPagina?: number }): FuenteMetricas {
  const c = crearClientePostgrest(o);
  const tamano = o.tamanoPagina ?? 1000;

  return {
    async pedidosDelDia(fecha, pais) {
      const ajustes = await c.filas('country_settings', `country_settings?country_code=${eq(pais)}&select=shipping_cost_estimate`);
      if (ajustes.length !== 1) throw new Error(`No hay country_settings para ${pais}.`);
      const estimado = entero(ajustes[0]!.shipping_cost_estimate, 'country_settings.shipping_cost_estimate');

      const desde = inicioDiaBogotaUtc(fecha).toISOString();
      const hasta = inicioDiaBogotaUtc(sumarDias(fecha, 1)).toISOString();
      const filtro = encodeURIComponent(
        `(and(paid_at.gte.${desde},paid_at.lt.${hasta}),and(paid_at.is.null,created_at.gte.${desde},created_at.lt.${hasta}))`,
      );
      const pedidos: PedidoMetrica[] = [];
      for (let offset = 0; ; offset += tamano) {
        const filas = await c.filas(
          'orders',
          `orders?country_code=${eq(pais)}&or=${filtro}&select=${SELECT_PEDIDO}&order=id.asc&limit=${tamano}&offset=${offset}`,
        );
        for (const f of filas) pedidos.push(aPedido(f, pais, estimado));
        if (filas.length < tamano) break;
      }
      return pedidos;
    },

    async guardarFilas(filas, ahora) {
      if (filas.length === 0) return;
      await c.pedir('daily_sales_stats', 'daily_sales_stats?on_conflict=date,country_code,payment_method', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(filas.map((f) => filaParaBase(f, ahora))),
      });
    },
  };
}
