/**
 * Fila de `orders` (más sus pagos aprobados) → `PedidoMetrica` de `@izao/core/metrics`. Código puro compartido por
 * el dashboard y el reporte de influencers: ninguna fórmula vive aquí, solo la lectura segura de la base
 * (montos como texto o entero → `bigint`, nada de floats; regla 1).
 */
import {
  METODOS_PAGO,
  comisionPasarelaDePagos,
  type MetodoPago,
  type PedidoMetrica,
} from '@izao/core/metrics';
import { fromDbAmount, type CountryCode, type CurrencyCode } from '@izao/core/money';
import { ORDER_STATUSES, type OrderStatus } from '@izao/core/order-state';

/** Columnas de `orders` que necesita la lectura (para el `select`). */
export const COLUMNAS_PEDIDO_METRICA =
  'id, country_code, currency_code, payment_method, status, created_at, paid_at, total_customer, discount_amount, financing_surcharge_amount, cod_deposit_amount, cod_collect_amount, product_cost_total, gateway_fee_estimated, carrier_fees, shipping_cost_real, influencer_id';

type Monto = number | string | bigint;

export type FilaPedidoMetrica = {
  id: string;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  payment_method: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  total_customer: Monto;
  discount_amount: Monto;
  financing_surcharge_amount: Monto;
  cod_deposit_amount: Monto;
  cod_collect_amount: Monto;
  product_cost_total: Monto;
  gateway_fee_estimated: Monto;
  carrier_fees: unknown;
  shipping_cost_real: Monto | null;
  influencer_id?: string | null;
};

export type PagoAprobado = { order_id: string; fee_amount: Monto | null };
export type EnvioPedido = { order_id: string; shipping_rate: Monto | null };

const ESTADOS = new Set<string>(ORDER_STATUSES);

function comisionPlataforma(carrierFees: unknown): bigint {
  if (carrierFees && typeof carrierFees === 'object') {
    const v = (carrierFees as Record<string, unknown>).plataforma;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return BigInt(v);
  }
  return 0n;
}

/**
 * Convierte una fila de la base. `null` si el método o el estado no son los conocidos (se descarta en vez de
 * inventar un valor). `envioEstimadoPais` es `country_settings.shipping_cost_estimate`.
 */
export function aPedidoMetrica(
  f: FilaPedidoMetrica,
  extra: { pagos?: readonly PagoAprobado[]; tarifaEnvio?: Monto | null; envioEstimadoPais?: Monto } = {},
): PedidoMetrica | null {
  if (!(METODOS_PAGO as readonly string[]).includes(f.payment_method) || !ESTADOS.has(f.status)) return null;
  const pagos = (extra.pagos ?? []).filter((p) => p.order_id === f.id);
  const estimada = fromDbAmount(f.gateway_fee_estimated);
  const comisionPasarela = comisionPasarelaDePagos(
    pagos.map((p) => ({ fee_amount: p.fee_amount === null ? null : fromDbAmount(p.fee_amount) })),
    estimada,
  );
  return {
    id: f.id,
    pais: f.country_code,
    moneda: f.currency_code,
    metodo: f.payment_method as MetodoPago,
    estado: f.status as OrderStatus,
    creadoEn: new Date(f.created_at),
    pagadoEn: f.paid_at ? new Date(f.paid_at) : null,
    total: fromDbAmount(f.total_customer),
    descuento: fromDbAmount(f.discount_amount),
    recargo: fromDbAmount(f.financing_surcharge_amount),
    abono: fromDbAmount(f.cod_deposit_amount),
    recaudo: fromDbAmount(f.cod_collect_amount),
    costoProducto: fromDbAmount(f.product_cost_total),
    comisionPasarela,
    comisionPlataforma: comisionPlataforma(f.carrier_fees),
    envioReal: f.shipping_cost_real === null ? null : fromDbAmount(f.shipping_cost_real),
    tarifaEnvio: extra.tarifaEnvio === undefined || extra.tarifaEnvio === null ? null : fromDbAmount(extra.tarifaEnvio),
    envioEstimadoPais: extra.envioEstimadoPais === undefined ? 0n : fromDbAmount(extra.envioEstimadoPais),
  };
}
