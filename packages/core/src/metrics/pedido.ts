/**
 * Hechos por pedido y filas de `daily_sales_stats` (§21.2 y §21.4). Funciones puras: el worker lee los
 * pedidos del día, llama a `filasVentasDiarias` y hace upsert de las 5 filas (una por método).
 *
 * Decisiones (bitácora izao-pagos, pendientes de visto bueno del líder):
 * - "Pagado" = `pagado`/`abono_pagado` o posteriores en el flujo. `cancelado` y `requiere_reembolso` no
 *   cuentan (el dinero se devuelve), aunque haya existido un pago.
 * - `manual` (Ecuador por WhatsApp) se trata como prepago: se marca pagado antes de despachar.
 * - Prepago "enviado" = entregado a la transportadora o después (incluye `devuelto` y `reclamacion`: el
 *   dinero ya está recibido; si se reembolsa pasa por `requiere_reembolso`/`cancelado`).
 * - Contra entrega: `entregado` aporta abono + recaudo; `devuelto` y `reclamacion` solo el abono.
 * - Comisiones, costo de producto y envío se cuentan sobre los pedidos que cuentan como ingreso, para que la
 *   utilidad del periodo compare ingresos y costos del mismo conjunto. El costo de producto excluye los
 *   devueltos (regresan al inventario).
 */
import { CURRENCY_EXPONENT, currencyForCountry, type CountryCode, type CurrencyCode } from '../money';
import type { OrderStatus } from '../order-state';
import { fechaBogota, type FechaIso } from './fechas';

export const METODOS_PAGO = ['wompi', 'addi', 'sistecredito', 'cod', 'manual'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

/** Pedido listo para métricas. Montos en unidad menor de `moneda`. */
export interface PedidoMetrica {
  readonly id: string;
  readonly pais: CountryCode;
  readonly moneda: CurrencyCode;
  readonly metodo: MetodoPago;
  readonly estado: OrderStatus;
  readonly creadoEn: Date;
  readonly pagadoEn: Date | null;
  /** `total_customer`. */
  readonly total: bigint;
  readonly descuento: bigint;
  /** `financing_surcharge_amount`. */
  readonly recargo: bigint;
  readonly abono: bigint;
  readonly recaudo: bigint;
  /** `product_cost_total` (Σ `unit_cost × quantity`). */
  readonly costoProducto: bigint;
  /** Comisión de Wompi/Addi/Sistecrédito (ver `comisionPasarelaDePagos`). */
  readonly comisionPasarela: bigint;
  /** "Comisión de plataforma" de la billetera de MasterShop (`carrier_fees.plataforma`). */
  readonly comisionPlataforma: bigint;
  /** `shipping_cost_real` (billetera: envío + devolución); `null` si aún no llega. */
  readonly envioReal: bigint | null;
  /** `shipments.shipping_rate`. */
  readonly tarifaEnvio: bigint | null;
  /** `country_settings.shipping_cost_estimate`. */
  readonly envioEstimadoPais: bigint;
}

const PAGADOS: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pagado',
  'abono_pagado',
  'error_transportadora',
  'enviado_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
]);

const ENVIADOS: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'enviado_transportadora',
  'en_preparacion',
  'en_transito',
  'entregado',
  'devuelto',
  'reclamacion',
]);

/** Contra entrega enviada y no finalizada: su recaudo está "por cobrar en tránsito". */
const EN_TRANSITO: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['enviado_transportadora', 'en_preparacion', 'en_transito']);

export function esPagado(estado: OrderStatus): boolean {
  return PAGADOS.has(estado);
}

export function cuentaComoIngreso(p: PedidoMetrica): boolean {
  if (p.metodo === 'cod') return p.estado === 'entregado' || p.estado === 'devuelto' || p.estado === 'reclamacion';
  return ENVIADOS.has(p.estado);
}

/** Aporte del pedido a "Ingresos totales (confirmados)". */
export function ingresoConfirmado(p: PedidoMetrica): bigint {
  if (!cuentaComoIngreso(p)) return 0n;
  if (p.metodo !== 'cod') return p.total;
  return p.estado === 'entregado' ? p.abono + p.recaudo : p.abono;
}

/** Costo real; si no ha llegado, `shippingRate`; si no, estimado del país. */
export function costoEnvioPedido(p: PedidoMetrica): { valor: bigint; estimado: boolean } {
  if (p.envioReal !== null) return { valor: p.envioReal, estimado: false };
  if (p.tarifaEnvio !== null) return { valor: p.tarifaEnvio, estimado: true };
  return { valor: p.envioEstimadoPais, estimado: true };
}

/**
 * Comisión de pasarela del pedido: suma de `payments.fee_amount` de los pagos aprobados cuando todos la
 * tienen; si falta alguna o no hay pagos, `orders.gateway_fee_estimated`.
 */
export function comisionPasarelaDePagos(aprobados: readonly { fee_amount: bigint | null }[], estimada: bigint): bigint {
  if (aprobados.length === 0) return estimada;
  let total = 0n;
  for (const p of aprobados) {
    if (p.fee_amount === null) return estimada;
    total += p.fee_amount;
  }
  return total;
}

/** Fecha de atribución (§21.1): `paid_at` en Bogotá, o `created_at` si no se ha pagado. */
export function fechaAtribucion(p: Pick<PedidoMetrica, 'creadoEn' | 'pagadoEn'>): FechaIso {
  return fechaBogota(p.pagadoEn ?? p.creadoEn);
}

/** Fila de `daily_sales_stats`, con los nombres de columna de la base. */
export interface FilaVentasDiarias {
  date: FechaIso;
  country_code: CountryCode;
  payment_method: MetodoPago;
  currency_code: CurrencyCode;
  orders_created: number;
  orders_paid: number;
  /** Pedidos en `abandonado` (para % abonos pagados). */
  orders_abandoned: number;
  gross_sales: bigint;
  discounts: bigint;
  surcharges: bigint;
  /** Abonos de contra entrega pagados. */
  cod_deposits: bigint;
  /** Recaudo de contra entrega enviada y no finalizada (por cobrar en tránsito). */
  cod_collect_sent: bigint;
  /** Total de prepagos enviados. */
  prepaid_sent_value: bigint;
  delivered_count: number;
  delivered_value: bigint;
  returned_count: number;
  returned_value: bigint;
  cod_deposits_returned: bigint;
  confirmed_revenue: bigint;
  gateway_fees: bigint;
  carrier_platform_fees: bigint;
  product_cost: bigint;
  shipping_cost: bigint;
  /** Pedidos cuyo envío aún es estimado (`shippingRate` o estimado del país). */
  shipping_estimated_count: number;
  /** Las garantías se leen de `warranty_claims` por su fecha; aquí siempre 0 (ver bitácora). */
  warranty_cost: bigint;
}

function filaVacia(date: FechaIso, pais: CountryCode, metodo: MetodoPago): FilaVentasDiarias {
  return {
    date,
    country_code: pais,
    payment_method: metodo,
    currency_code: currencyForCountry(pais),
    orders_created: 0,
    orders_paid: 0,
    orders_abandoned: 0,
    gross_sales: 0n,
    discounts: 0n,
    surcharges: 0n,
    cod_deposits: 0n,
    cod_collect_sent: 0n,
    prepaid_sent_value: 0n,
    delivered_count: 0,
    delivered_value: 0n,
    returned_count: 0,
    returned_value: 0n,
    cod_deposits_returned: 0n,
    confirmed_revenue: 0n,
    gateway_fees: 0n,
    carrier_platform_fees: 0n,
    product_cost: 0n,
    shipping_cost: 0n,
    shipping_estimated_count: 0,
    warranty_cost: 0n,
  };
}

const CAMPOS_MONTO = [
  'total',
  'descuento',
  'recargo',
  'abono',
  'recaudo',
  'costoProducto',
  'comisionPasarela',
  'comisionPlataforma',
  'envioEstimadoPais',
] as const;

function validarPedido(p: PedidoMetrica, fecha: FechaIso, pais: CountryCode): void {
  if (p.pais !== pais) throw new RangeError(`Pedido ${p.id}: país ${p.pais}, se esperaba ${pais}.`);
  if (p.moneda !== currencyForCountry(pais) || !(p.moneda in CURRENCY_EXPONENT)) {
    throw new RangeError(`Pedido ${p.id}: moneda ${p.moneda} no corresponde a ${pais}.`);
  }
  if (!(METODOS_PAGO as readonly string[]).includes(p.metodo)) throw new RangeError(`Pedido ${p.id}: método desconocido.`);
  for (const c of CAMPOS_MONTO) {
    const v = p[c];
    if (typeof v !== 'bigint' || v < 0n) throw new RangeError(`Pedido ${p.id}: ${c} inválido.`);
  }
  for (const v of [p.envioReal, p.tarifaEnvio]) {
    if (v !== null && (typeof v !== 'bigint' || v < 0n)) throw new RangeError(`Pedido ${p.id}: envío inválido.`);
  }
  if (fechaAtribucion(p) !== fecha) throw new RangeError(`Pedido ${p.id}: no se atribuye a ${fecha}.`);
}

/**
 * Las 5 filas (una por método, aunque estén en cero, para pisar valores viejos) del día `fecha` y país
 * `pais`. `pedidos` debe ser exactamente el conjunto atribuido a ese día y país.
 */
export function filasVentasDiarias(pedidos: readonly PedidoMetrica[], fecha: FechaIso, pais: CountryCode): FilaVentasDiarias[] {
  const filas = new Map<MetodoPago, FilaVentasDiarias>(METODOS_PAGO.map((m) => [m, filaVacia(fecha, pais, m)]));
  const vistos = new Set<string>();
  for (const p of pedidos) {
    validarPedido(p, fecha, pais);
    if (vistos.has(p.id)) throw new RangeError(`Pedido ${p.id} repetido.`);
    vistos.add(p.id);
    const f = filas.get(p.metodo)!;
    const cod = p.metodo === 'cod';
    f.orders_created += 1;
    if (p.estado === 'abandonado') f.orders_abandoned += 1;
    if (esPagado(p.estado)) {
      f.orders_paid += 1;
      f.gross_sales += p.total;
      f.discounts += p.descuento;
      f.surcharges += p.recargo;
      if (cod) f.cod_deposits += p.abono;
    }
    if (cod && EN_TRANSITO.has(p.estado)) f.cod_collect_sent += p.recaudo;
    if (!cod && ENVIADOS.has(p.estado)) f.prepaid_sent_value += p.total;
    if (p.estado === 'entregado') {
      f.delivered_count += 1;
      f.delivered_value += p.total;
    }
    if (p.estado === 'devuelto') {
      f.returned_count += 1;
      f.returned_value += p.total;
      if (cod) f.cod_deposits_returned += p.abono;
    }
    if (cuentaComoIngreso(p)) {
      f.confirmed_revenue += ingresoConfirmado(p);
      f.gateway_fees += p.comisionPasarela;
      f.carrier_platform_fees += p.comisionPlataforma;
      if (p.estado !== 'devuelto') f.product_cost += p.costoProducto;
      const envio = costoEnvioPedido(p);
      f.shipping_cost += envio.valor;
      if (envio.estimado) f.shipping_estimated_count += 1;
    }
  }
  return [...filas.values()];
}
