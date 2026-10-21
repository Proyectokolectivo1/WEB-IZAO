/**
 * KPIs del dashboard (§21.2) a partir de las filas de `daily_sales_stats`, el tráfico, los gastos y las
 * garantías del periodo. Cada país se resume en su moneda; "Todos" = cada país por separado + consolidado
 * en COP con `fx_rate_to_cop` (nunca se suman COP y USD sin convertir).
 *
 * Razones en puntos básicos (`Bp`: valor × 10 000; 2 805n = 28,05 %; ROAS 112 000n = 11,2×), redondeo
 * medio hacia arriba, `null` cuando el denominador es 0. Sin `float` en ningún paso.
 */
import { CURRENCY_EXPONENT, currencyForCountry, roundHalfUpDiv, type CountryCode, type CurrencyCode } from '../money';
import type { FechaIso } from './fechas';
import { METODOS_PAGO, type FilaVentasDiarias, type MetodoPago } from './pedido';

export type Bp = bigint;
const BP = 10_000n;

export function razonBp(numerador: bigint, denominador: bigint): Bp | null {
  if (denominador === 0n) return null;
  return roundHalfUpDiv(numerador * BP, denominador);
}

/** Variación relativa contra el periodo anterior; `null` si el anterior es 0. */
export function variacionBp(actual: bigint, anterior: bigint): Bp | null {
  if (anterior === 0n) return null;
  return roundHalfUpDiv((actual - anterior) * BP, anterior < 0n ? -anterior : anterior);
}

/** `fx_rate_to_cop` (`numeric(18,6)`, COP por 1 unidad mayor) → millonésimas. `null` si no es válida o ≤ 0. */
export function parseTasaMicro(valor: unknown): bigint | null {
  let texto: string;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null;
    texto = String(valor);
  } else if (typeof valor === 'string') {
    texto = valor.trim();
  } else {
    return null;
  }
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(texto);
  if (!m) return null;
  const micro = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
  return micro > 0n ? micro : null;
}

/** Monto en unidad menor de `moneda` → pesos colombianos, con la tasa en millonésimas. */
export function convertirACop(monto: bigint, moneda: CurrencyCode, tasaMicro: bigint): bigint {
  if (moneda === 'COP') return monto;
  const divisor = 10n ** BigInt(CURRENCY_EXPONENT[moneda] - CURRENCY_EXPONENT.COP) * 1_000_000n;
  return roundHalfUpDiv(monto * tasaMicro, divisor);
}

export interface TraficoMetrica {
  readonly fecha: FechaIso;
  readonly pais: CountryCode;
  readonly sesiones: bigint;
  readonly vistasProducto: bigint;
  readonly carrito: bigint;
  readonly checkouts: bigint;
}

export interface GastoMetrica {
  readonly fecha: FechaIso;
  readonly pais: CountryCode;
  readonly moneda: CurrencyCode;
  /** `expense_categories.slug`. */
  readonly categoria: string;
  readonly monto: bigint;
}

export const ESTADOS_GARANTIA = ['recibida', 'en_revision', 'aprobada', 'rechazada', 'resuelta'] as const;
export type EstadoGarantia = (typeof ESTADOS_GARANTIA)[number];

export interface GarantiaMetrica {
  readonly pais: CountryCode;
  readonly estado: EstadoGarantia;
  /** `cost_amount` (costo asumido). Los casos rechazados no suman costo. */
  readonly costo: bigint;
}

export interface ComisionesProveedor {
  wompi: bigint;
  addi: bigint;
  sistecredito: bigint;
  mastershop: bigint;
  total: bigint;
}

export interface VentasMetodo {
  pedidosPagados: number;
  ventasBrutas: bigint;
  recargos: bigint;
}

/** Componentes que se suman (y se convierten a COP al consolidar). */
interface Base {
  pedidosCreados: number;
  pedidosPagados: number;
  ventasBrutas: bigint;
  descuentos: bigint;
  recargos: bigint;
  ingresosConfirmados: bigint;
  porCobrarEnTransito: bigint;
  comisiones: Omit<ComisionesProveedor, 'total'>;
  costoProducto: bigint;
  costoEnvios: bigint;
  enviosEstimados: number;
  garantiasCasos: number;
  garantiasPorEstado: Partial<Record<EstadoGarantia, number>>;
  garantiasCosto: bigint;
  gastosPorCategoria: Record<string, bigint>;
  gastoPauta: bigint;
  porMetodo: Record<MetodoPago, VentasMetodo>;
  embudo: { sesiones: bigint; vistasProducto: bigint; carrito: bigint; checkouts: bigint };
  contadores: { entregados: number; abonosPagados: number; abandonados: number; codEntregados: number; codDevueltos: number };
}

export interface ResumenPais {
  /** `null` en el consolidado. */
  pais: CountryCode | null;
  moneda: CurrencyCode;
  pedidosCreados: number;
  pedidosPagados: number;
  ventasBrutas: bigint;
  descuentos: bigint;
  recargos: bigint;
  ingresosConfirmados: bigint;
  porCobrarEnTransito: bigint;
  comisiones: ComisionesProveedor;
  costoProducto: bigint;
  costoEnvios: bigint;
  /** Pedidos con envío estimado (indicador "estimado" en el panel). */
  enviosEstimados: number;
  garantias: { casos: number; porEstado: Partial<Record<EstadoGarantia, number>>; costo: bigint; tasaBp: Bp | null };
  gastos: { total: bigint; porCategoria: Record<string, bigint> };
  gastoPauta: bigint;
  utilidadNeta: bigint;
  margenNetoBp: Bp | null;
  ticketPromedio: bigint | null;
  conversionBp: Bp | null;
  abonosPagadosBp: Bp | null;
  rechazoContraEntregaBp: Bp | null;
  roasBp: Bp | null;
  embudo: { sesiones: bigint; vistasProducto: bigint; carrito: bigint; checkouts: bigint; pagados: bigint };
  porMetodo: Record<MetodoPago, VentasMetodo>;
  contadores: Base['contadores'];
}

export interface EntradaResumen {
  pais: CountryCode;
  filas: readonly FilaVentasDiarias[];
  trafico: readonly TraficoMetrica[];
  gastos: readonly GastoMetrica[];
  garantias: readonly GarantiaMetrica[];
  /** Categorías de gasto que cuentan como pauta para el ROAS. Por defecto, los slugs `pauta_*`. */
  esPauta?: (categoria: string) => boolean;
}

const pautaPorDefecto = (categoria: string): boolean => categoria.startsWith('pauta_');

function porMetodoVacio(): Record<MetodoPago, VentasMetodo> {
  return Object.fromEntries(METODOS_PAGO.map((m) => [m, { pedidosPagados: 0, ventasBrutas: 0n, recargos: 0n }])) as Record<
    MetodoPago,
    VentasMetodo
  >;
}

function baseVacia(): Base {
  return {
    pedidosCreados: 0,
    pedidosPagados: 0,
    ventasBrutas: 0n,
    descuentos: 0n,
    recargos: 0n,
    ingresosConfirmados: 0n,
    porCobrarEnTransito: 0n,
    comisiones: { wompi: 0n, addi: 0n, sistecredito: 0n, mastershop: 0n },
    costoProducto: 0n,
    costoEnvios: 0n,
    enviosEstimados: 0,
    garantiasCasos: 0,
    garantiasPorEstado: {},
    garantiasCosto: 0n,
    gastosPorCategoria: {},
    gastoPauta: 0n,
    porMetodo: porMetodoVacio(),
    embudo: { sesiones: 0n, vistasProducto: 0n, carrito: 0n, checkouts: 0n },
    contadores: { entregados: 0, abonosPagados: 0, abandonados: 0, codEntregados: 0, codDevueltos: 0 },
  };
}

/** Proveedor que cobra la comisión de pasarela de cada método (el abono de contra entrega va por Wompi). */
const PROVEEDOR_PASARELA: Readonly<Record<MetodoPago, 'wompi' | 'addi' | 'sistecredito' | null>> = Object.freeze({
  wompi: 'wompi',
  cod: 'wompi',
  addi: 'addi',
  sistecredito: 'sistecredito',
  manual: null,
});

function baseDePais(e: EntradaResumen): Base {
  const moneda = currencyForCountry(e.pais);
  const esPauta = e.esPauta ?? pautaPorDefecto;
  const b = baseVacia();
  const vistas = new Set<string>();
  for (const f of e.filas) {
    if (f.country_code !== e.pais || f.currency_code !== moneda) {
      throw new RangeError(`Fila ${f.date}/${f.payment_method}: ${f.country_code}/${f.currency_code} no es ${e.pais}/${moneda}.`);
    }
    const clave = `${f.date}|${f.payment_method}`;
    if (vistas.has(clave)) throw new RangeError(`Fila repetida ${clave}.`);
    vistas.add(clave);
    b.pedidosCreados += f.orders_created;
    b.pedidosPagados += f.orders_paid;
    b.ventasBrutas += f.gross_sales;
    b.descuentos += f.discounts;
    b.recargos += f.surcharges;
    b.ingresosConfirmados += f.confirmed_revenue;
    b.porCobrarEnTransito += f.cod_collect_sent;
    const prov = PROVEEDOR_PASARELA[f.payment_method];
    if (prov === null) {
      if (f.gateway_fees !== 0n) throw new RangeError(`Fila ${clave}: el método manual no tiene pasarela.`);
    } else {
      b.comisiones[prov] += f.gateway_fees;
    }
    b.comisiones.mastershop += f.carrier_platform_fees;
    b.costoProducto += f.product_cost;
    b.costoEnvios += f.shipping_cost;
    b.enviosEstimados += f.shipping_estimated_count;
    const pm = b.porMetodo[f.payment_method];
    pm.pedidosPagados += f.orders_paid;
    pm.ventasBrutas += f.gross_sales;
    pm.recargos += f.surcharges;
    b.contadores.entregados += f.delivered_count;
    if (f.payment_method === 'cod') {
      b.contadores.abonosPagados += f.orders_paid;
      b.contadores.abandonados += f.orders_abandoned;
      b.contadores.codEntregados += f.delivered_count;
      b.contadores.codDevueltos += f.returned_count;
    }
  }
  for (const t of e.trafico) {
    if (t.pais !== e.pais) throw new RangeError(`Tráfico de ${t.pais} en el resumen de ${e.pais}.`);
    b.embudo.sesiones += t.sesiones;
    b.embudo.vistasProducto += t.vistasProducto;
    b.embudo.carrito += t.carrito;
    b.embudo.checkouts += t.checkouts;
  }
  for (const g of e.gastos) {
    if (g.pais !== e.pais || g.moneda !== moneda) {
      throw new RangeError(`Gasto ${g.fecha} en ${g.pais}/${g.moneda}: no es ${e.pais}/${moneda}.`);
    }
    if (typeof g.monto !== 'bigint' || g.monto < 0n) throw new RangeError('Gasto con monto inválido.');
    b.gastosPorCategoria[g.categoria] = (b.gastosPorCategoria[g.categoria] ?? 0n) + g.monto;
    if (esPauta(g.categoria)) b.gastoPauta += g.monto;
  }
  for (const w of e.garantias) {
    if (w.pais !== e.pais) throw new RangeError(`Garantía de ${w.pais} en el resumen de ${e.pais}.`);
    b.garantiasCasos += 1;
    b.garantiasPorEstado[w.estado] = (b.garantiasPorEstado[w.estado] ?? 0) + 1;
    if (w.estado !== 'rechazada') b.garantiasCosto += w.costo;
  }
  return b;
}

function derivar(pais: CountryCode | null, moneda: CurrencyCode, b: Base): ResumenPais {
  const comisionesTotal = b.comisiones.wompi + b.comisiones.addi + b.comisiones.sistecredito + b.comisiones.mastershop;
  const gastosTotal = Object.values(b.gastosPorCategoria).reduce((a, v) => a + v, 0n);
  const utilidadNeta =
    b.ingresosConfirmados - comisionesTotal - b.costoProducto - b.costoEnvios - b.garantiasCosto - gastosTotal;
  const pagados = BigInt(b.pedidosPagados);
  const c = b.contadores;
  return {
    pais,
    moneda,
    pedidosCreados: b.pedidosCreados,
    pedidosPagados: b.pedidosPagados,
    ventasBrutas: b.ventasBrutas,
    descuentos: b.descuentos,
    recargos: b.recargos,
    ingresosConfirmados: b.ingresosConfirmados,
    porCobrarEnTransito: b.porCobrarEnTransito,
    comisiones: { ...b.comisiones, total: comisionesTotal },
    costoProducto: b.costoProducto,
    costoEnvios: b.costoEnvios,
    enviosEstimados: b.enviosEstimados,
    garantias: {
      casos: b.garantiasCasos,
      porEstado: { ...b.garantiasPorEstado },
      costo: b.garantiasCosto,
      tasaBp: razonBp(BigInt(b.garantiasCasos), BigInt(c.entregados)),
    },
    gastos: { total: gastosTotal, porCategoria: { ...b.gastosPorCategoria } },
    gastoPauta: b.gastoPauta,
    utilidadNeta,
    margenNetoBp: razonBp(utilidadNeta, b.ingresosConfirmados),
    ticketPromedio: pagados === 0n ? null : roundHalfUpDiv(b.ventasBrutas, pagados),
    conversionBp: razonBp(pagados, b.embudo.sesiones),
    abonosPagadosBp: razonBp(BigInt(c.abonosPagados), BigInt(c.abonosPagados + c.abandonados)),
    rechazoContraEntregaBp: razonBp(BigInt(c.codDevueltos), BigInt(c.codEntregados + c.codDevueltos)),
    roasBp: razonBp(b.ventasBrutas, b.gastoPauta),
    embudo: { ...b.embudo, pagados },
    porMetodo: Object.fromEntries(METODOS_PAGO.map((m) => [m, { ...b.porMetodo[m] }])) as Record<MetodoPago, VentasMetodo>,
    contadores: { ...c },
  };
}

/** Resumen de un país en su moneda. */
export function resumenPais(e: EntradaResumen): ResumenPais {
  return derivar(e.pais, currencyForCountry(e.pais), baseDePais(e));
}

function baseDeResumen(r: ResumenPais): Base {
  return {
    pedidosCreados: r.pedidosCreados,
    pedidosPagados: r.pedidosPagados,
    ventasBrutas: r.ventasBrutas,
    descuentos: r.descuentos,
    recargos: r.recargos,
    ingresosConfirmados: r.ingresosConfirmados,
    porCobrarEnTransito: r.porCobrarEnTransito,
    comisiones: { wompi: r.comisiones.wompi, addi: r.comisiones.addi, sistecredito: r.comisiones.sistecredito, mastershop: r.comisiones.mastershop },
    costoProducto: r.costoProducto,
    costoEnvios: r.costoEnvios,
    enviosEstimados: r.enviosEstimados,
    garantiasCasos: r.garantias.casos,
    garantiasPorEstado: r.garantias.porEstado,
    garantiasCosto: r.garantias.costo,
    gastosPorCategoria: r.gastos.porCategoria,
    gastoPauta: r.gastoPauta,
    porMetodo: r.porMetodo,
    embudo: { sesiones: r.embudo.sesiones, vistasProducto: r.embudo.vistasProducto, carrito: r.embudo.carrito, checkouts: r.embudo.checkouts },
    contadores: r.contadores,
  };
}

/** Suma `de` en `en`, convirtiendo cada monto con `conv` (un redondeo por componente). */
function acumular(en: Base, de: Base, conv: (m: bigint) => bigint): void {
  en.pedidosCreados += de.pedidosCreados;
  en.pedidosPagados += de.pedidosPagados;
  en.ventasBrutas += conv(de.ventasBrutas);
  en.descuentos += conv(de.descuentos);
  en.recargos += conv(de.recargos);
  en.ingresosConfirmados += conv(de.ingresosConfirmados);
  en.porCobrarEnTransito += conv(de.porCobrarEnTransito);
  for (const k of ['wompi', 'addi', 'sistecredito', 'mastershop'] as const) en.comisiones[k] += conv(de.comisiones[k]);
  en.costoProducto += conv(de.costoProducto);
  en.costoEnvios += conv(de.costoEnvios);
  en.enviosEstimados += de.enviosEstimados;
  en.garantiasCasos += de.garantiasCasos;
  for (const [k, v] of Object.entries(de.garantiasPorEstado) as [EstadoGarantia, number][]) {
    en.garantiasPorEstado[k] = (en.garantiasPorEstado[k] ?? 0) + v;
  }
  en.garantiasCosto += conv(de.garantiasCosto);
  for (const [k, v] of Object.entries(de.gastosPorCategoria)) en.gastosPorCategoria[k] = (en.gastosPorCategoria[k] ?? 0n) + conv(v);
  en.gastoPauta += conv(de.gastoPauta);
  for (const m of METODOS_PAGO) {
    en.porMetodo[m].pedidosPagados += de.porMetodo[m].pedidosPagados;
    en.porMetodo[m].ventasBrutas += conv(de.porMetodo[m].ventasBrutas);
    en.porMetodo[m].recargos += conv(de.porMetodo[m].recargos);
  }
  for (const k of ['sesiones', 'vistasProducto', 'carrito', 'checkouts'] as const) en.embudo[k] += de.embudo[k];
  for (const k of ['entregados', 'abonosPagados', 'abandonados', 'codEntregados', 'codDevueltos'] as const) {
    en.contadores[k] += de.contadores[k];
  }
}

/**
 * Consolidado en COP de varios países. Cada componente se convierte con la tasa de su país y las razones
 * (margen, ticket, ROAS…) se recalculan sobre los totales convertidos. Si falta la tasa de un país que no
 * está en COP, no se consolida (la tasa es dato del dueño: no se inventa).
 */
export function consolidarEnCop(
  resumenes: readonly ResumenPais[],
  tasas: Partial<Record<CountryCode, unknown>>,
): ResumenPais | { error: 'sin_tasa'; pais: CountryCode } {
  const total = baseVacia();
  const paises = new Set<CountryCode>();
  for (const r of resumenes) {
    if (r.pais === null) throw new RangeError('No se consolida un consolidado.');
    if (paises.has(r.pais)) throw new RangeError(`País ${r.pais} repetido en el consolidado.`);
    paises.add(r.pais);
    let conv = (m: bigint): bigint => m;
    if (r.moneda !== 'COP') {
      const tasa = parseTasaMicro(tasas[r.pais]);
      if (tasa === null) return { error: 'sin_tasa', pais: r.pais };
      const moneda = r.moneda;
      conv = (m) => convertirACop(m, moneda, tasa);
    }
    acumular(total, baseDeResumen(r), conv);
  }
  return derivar(null, 'COP', total);
}

/** Punto de la gráfica de ventas e ingresos por día (días sin filas en cero). */
export interface PuntoDiario {
  fecha: FechaIso;
  ventasBrutas: bigint;
  ingresosConfirmados: bigint;
  pedidosPagados: number;
}

export function serieDiaria(filas: readonly FilaVentasDiarias[], dias: readonly FechaIso[]): PuntoDiario[] {
  const monedas = new Set(filas.map((f) => f.currency_code));
  if (monedas.size > 1) throw new RangeError('La serie diaria no mezcla monedas.');
  const porDia = new Map<FechaIso, PuntoDiario>(dias.map((d) => [d, { fecha: d, ventasBrutas: 0n, ingresosConfirmados: 0n, pedidosPagados: 0 }]));
  for (const f of filas) {
    const p = porDia.get(f.date);
    if (!p) continue;
    p.ventasBrutas += f.gross_sales;
    p.ingresosConfirmados += f.confirmed_revenue;
    p.pedidosPagados += f.orders_paid;
  }
  return [...porDia.values()];
}
