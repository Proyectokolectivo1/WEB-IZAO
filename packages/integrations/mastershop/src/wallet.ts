/**
 * Billetera de MasterShop (§14.5 paso 5): movimientos de `POST /api/wallets/movements/list` → costos reales por
 * pedido (`orders.shipping_cost_real`, `orders.carrier_fees`), gastos sin pedido (`expenses`, categoría
 * "MasterShop") y saldo.
 *
 * Montos: la colección muestra decimales (`85000.5`) en COP. Se leen como texto decimal, sin `float`: hasta 2
 * decimales se llevan a la unidad menor (en COP, medio hacia arriba con `roundHalfUpDiv`); más de 2 decimales
 * significativos no es un monto de dinero válido → `null` y aviso, como el listado (D-052). `[VERIFICAR]` el signo real de los
 * cobros: se toma la magnitud de cada movimiento de costo (D-027).
 */
import { CURRENCY_EXPONENT, roundHalfUpDiv, toSafeNumber, type CurrencyCode } from '@izao/core/money';

/** Conceptos que se asignan al pedido por `idOrder` y su clave en `carrier_fees`. */
export const CONCEPTOS_COSTO_PEDIDO: Readonly<Record<string, ClaveCostoPedido>> = Object.freeze({
  'Cobro por Envío': 'envio',
  'Cobro por Devolución': 'devolucion',
  'Comisión de plataforma': 'plataforma',
  'Cobro por envío mensaje de WhatsApp': 'whatsapp',
});

export type ClaveCostoPedido = 'envio' | 'devolucion' | 'plataforma' | 'whatsapp';

/** Conceptos de costo que, sin pedido de la tienda, van a `expenses` (no recargas, ingresos ni retiros). */
export const CONCEPTOS_GASTO_SIN_PEDIDO: ReadonlySet<string> = new Set([
  ...Object.keys(CONCEPTOS_COSTO_PEDIDO),
  'Cuota de Manejo Shopcard',
]);

/** Estados de movimiento que no cuentan (la operación no se hizo). */
export const ESTADOS_MOVIMIENTO_IGNORADOS: ReadonlySet<string> = new Set(['ERROR']);

/** Ventana del job horario (§14.5): últimos 3 días, siempre con `startDate`. */
export const VENTANA_BILLETERA_DIAS = 3;

export interface MovimientoBilletera {
  id: number;
  idOrder: number | null;
  concepto: string;
  estado: string | null;
  moneda: CurrencyCode;
  /** Valor con su signo, en unidad menor (redondeado medio hacia arriba). */
  valor: bigint;
  /** `newBalance` en unidad menor; `null` si no vino o no se pudo leer. */
  saldoNuevo: bigint | null;
  /** `balanceMovementDate` (ISO). */
  fecha: string;
  guia: string | null;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Decimales máximos que se aceptan en un monto de la API (centavos); los ceros sobrantes no cuentan. */
const DECIMALES_MAXIMOS = 2;

/**
 * Monto de la API (número JSON o texto decimal, unidad mayor) → unidad menor. Hasta 2 decimales: exacto en USD;
 * en COP se redondea a peso medio hacia arriba (alejándose de cero). `null` si no es un decimal simple (p. ej.
 * notación científica) o si trae más de 2 decimales significativos (`10.005`): no se redondea, se avisa.
 */
export function montoBilletera(v: unknown, moneda: CurrencyCode): bigint | null {
  if (typeof v === 'bigint') return v * 10n ** BigInt(CURRENCY_EXPONENT[moneda]);
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  const m = DECIMAL.exec(String(v).trim());
  if (!m) return null;
  const [, signo, entero, fracCruda = ''] = m;
  const frac = fracCruda.replace(/0+$/, '');
  if (frac.length > DECIMALES_MAXIMOS) return null;
  const exp = CURRENCY_EXPONENT[moneda];
  const digitos = BigInt(entero! + frac);
  const escala = frac.length - exp;
  const menor = escala <= 0 ? digitos * 10n ** BigInt(-escala) : roundHalfUpDiv(digitos, 10n ** BigInt(escala));
  return signo === '-' ? -menor : menor;
}

const MAGNITUD = (x: bigint): bigint => (x < 0n ? -x : x);

/** Totales de costo por pedido (unidad menor, enteros seguros para `jsonb`). */
export interface CostosPedido {
  shipping_cost_real: bigint;
  carrier_fees: CarrierFees;
}

/** Forma de `orders.carrier_fees` escrita por el job (montos en unidad menor). */
export interface CarrierFees {
  fuente: 'mastershop_wallet';
  envio: number;
  devolucion: number;
  plataforma: number;
  whatsapp: number;
  /** Movimientos ya asignados por `idBalanceMovement` (para recalcular sin duplicar). */
  movimientos: Record<string, { concepto: string; valor: number; fecha: string }>;
}

/** Lee los movimientos ya guardados en `carrier_fees` (tolerante a forma vieja o vacía). */
export function movimientosGuardados(carrierFees: unknown): CarrierFees['movimientos'] {
  if (typeof carrierFees !== 'object' || carrierFees === null) return {};
  const m = (carrierFees as { movimientos?: unknown }).movimientos;
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return {};
  const r: CarrierFees['movimientos'] = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (!/^\d+$/.test(k) || typeof v !== 'object' || v === null) continue;
    const x = v as Record<string, unknown>;
    if (typeof x.concepto === 'string' && typeof x.valor === 'number' && Number.isSafeInteger(x.valor) && typeof x.fecha === 'string') {
      r[k] = { concepto: x.concepto, valor: x.valor, fecha: x.fecha };
    }
  }
  return r;
}

/** Une movimientos nuevos con los guardados (por id) y recalcula los totales. Idempotente. */
export function costosPedido(carrierFeesPrevio: unknown, nuevos: readonly MovimientoBilletera[]): CostosPedido {
  const movimientos = movimientosGuardados(carrierFeesPrevio);
  for (const n of nuevos) {
    if (!(n.concepto in CONCEPTOS_COSTO_PEDIDO)) continue;
    if (n.estado !== null && ESTADOS_MOVIMIENTO_IGNORADOS.has(n.estado)) {
      delete movimientos[String(n.id)];
      continue;
    }
    movimientos[String(n.id)] = { concepto: n.concepto, valor: toSafeNumber(MAGNITUD(n.valor)), fecha: n.fecha };
  }
  const t: Record<ClaveCostoPedido, bigint> = { envio: 0n, devolucion: 0n, plataforma: 0n, whatsapp: 0n };
  for (const m of Object.values(movimientos)) {
    const clave = CONCEPTOS_COSTO_PEDIDO[m.concepto];
    if (clave) t[clave] += BigInt(m.valor);
  }
  return {
    shipping_cost_real: t.envio + t.devolucion,
    carrier_fees: {
      fuente: 'mastershop_wallet',
      envio: toSafeNumber(t.envio),
      devolucion: toSafeNumber(t.devolucion),
      plataforma: toSafeNumber(t.plataforma),
      whatsapp: toSafeNumber(t.whatsapp),
      movimientos,
    },
  };
}

/** `true` si el movimiento sin pedido de la tienda es un gasto (`expenses`). */
export function esGastoSinPedido(m: MovimientoBilletera): boolean {
  if (m.estado !== null && ESTADOS_MOVIMIENTO_IGNORADOS.has(m.estado)) return false;
  return CONCEPTOS_GASTO_SIN_PEDIDO.has(m.concepto) && m.valor !== 0n;
}

/** Monto del gasto (magnitud) en unidad menor. */
export function montoGasto(m: MovimientoBilletera): bigint {
  return MAGNITUD(m.valor);
}

/** Saldo más reciente de una lista de movimientos (por `fecha`, luego id). */
export function saldoMasReciente(movs: readonly MovimientoBilletera[]): { saldo: bigint; fecha: string } | null {
  let mejor: MovimientoBilletera | null = null;
  for (const m of movs) {
    if (m.saldoNuevo === null) continue;
    if (!mejor || m.fecha > mejor.fecha || (m.fecha === mejor.fecha && m.id > mejor.id)) mejor = m;
  }
  return mejor ? { saldo: mejor.saldoNuevo!, fecha: mejor.fecha } : null;
}

export type EstadoAlertaSaldo = 'sin_umbral' | 'sin_saldo' | 'ok' | 'nueva' | 'activa' | 'resuelta';

/**
 * Alerta de saldo bajo con histéresis simple: avisa una vez al cruzar por debajo del umbral y se rearma
 * cuando el saldo vuelve a estar en o por encima.
 */
export function evaluarSaldo(saldo: bigint | null, umbral: bigint | null, alertaActiva: boolean): EstadoAlertaSaldo {
  if (umbral === null) return alertaActiva ? 'resuelta' : 'sin_umbral';
  if (saldo === null) return 'sin_saldo';
  if (saldo < umbral) return alertaActiva ? 'activa' : 'nueva';
  return alertaActiva ? 'resuelta' : 'ok';
}
