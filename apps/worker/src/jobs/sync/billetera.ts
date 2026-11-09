/**
 * Job horario de billetera de MasterShop (§14.5 paso 5, §21): lista los movimientos de los últimos 3 días (siempre
 * con `startDate`; sin él la API devuelve 7 días) y:
 *
 * - asigna a cada pedido de la tienda (por `idOrder` = `shipments.provider_order_id`) "Cobro por Envío",
 *   "Cobro por Devolución", "Comisión de plataforma" y "Cobro por envío mensaje de WhatsApp"
 *   → `orders.shipping_cost_real` (envío + devolución) y `orders.carrier_fees` (desglose + movimientos por id);
 * - registra en `expenses` (categoría "MasterShop", `source = mastershop_wallet`, `external_ref =
 *   {PAIS}:{idBalanceMovement}`) los cobros sin pedido de la tienda (el país evita que dos cuentas choquen, D-052);
 * - encola el recálculo de `daily_sales_stats` de los días de cada pedido cuyos costos cambiaron (§21.4);
 * - guarda el saldo (`newBalance` más reciente) y evalúa la alerta de saldo bajo con el umbral configurable.
 *
 * Idempotente: los movimientos se guardan por id dentro de `carrier_fees` y los totales se recalculan; el gasto
 * duplicado choca con el índice único `(source, external_ref)` y se cuenta como ya existente.
 */
import {
  VENTANA_BILLETERA_DIAS,
  costosPedido,
  esGastoSinPedido,
  evaluarSaldo,
  montoGasto,
  saldoMasReciente,
  type CarrierFees,
  type EstadoAlertaSaldo,
  type MasterShopCredentials,
  type MovimientoBilletera,
} from '@izao/mastershop';
import type { CountryCode } from '@izao/core/money';
import type { RecalcularMetricasPedido } from '../metrics/tras-transicion.js';

export const JOB_BILLETERA_MASTERSHOP = 'mastershop.billetera';
/** Cada hora, al minuto 7 (lejos del polling de cada 10 min). */
export const CRON_BILLETERA_MASTERSHOP = '7 * * * *';

export interface PedidoBilletera {
  order_id: string;
  provider_order_id: number;
  carrier_fees: unknown;
}

export interface GastoBilletera {
  /** `{PAIS}:{idBalanceMovement}` (D-052). */
  external_ref: string;
  /**
   * Referencias anteriores del mismo movimiento que cuentan como "ya registrado": en CO, el id sin prefijo con que
   * se guardaron los gastos antes de D-052 (no se migran datos).
   */
  refs_previas?: readonly string[];
  /** Fecha del movimiento en America/Bogota (`YYYY-MM-DD`). */
  date: string;
  amount: bigint;
  description: string;
}

export interface EstadoSaldo {
  /** `null` = alerta desactivada. */
  umbral: bigint | null;
  alertaActiva: boolean;
}

/**
 * Cada país tiene su propia llave, su billetera y su moneda en MasterShop (D-052): todo lo que depende del país
 * (llave, gasto, saldo) recibe `pais`.
 */
export interface FuenteBilletera {
  credenciales(pais: CountryCode): Promise<MasterShopCredentials | null>;
  /**
   * Pedidos de la tienda del país por `provider_order_id`. Los ids son de la cuenta de ese país: dos cuentas pueden
   * repetir un `idOrder`, así que se filtra por `orders.country_code`.
   */
  pedidosPorIdProveedor(ids: readonly number[], pais: CountryCode): Promise<PedidoBilletera[]>;
  guardarCostos(orderId: string, shipping_cost_real: bigint, carrier_fees: CarrierFees): Promise<void>;
  /** `true` si lo creó; `false` si ya existía (índice único). Gasto del país, en su moneda. */
  registrarGasto(g: GastoBilletera, pais: CountryCode): Promise<boolean>;
  /** `null` si el país aún no tiene las columnas del saldo (pendiente de izao-db). */
  estadoSaldo(pais: CountryCode): Promise<EstadoSaldo | null>;
  guardarSaldo(saldo: { valor: bigint; fecha: Date } | null, alertaActiva: boolean, ahora: Date, pais: CountryCode): Promise<void>;
}

export interface DepsBilletera {
  fuente: FuenteBilletera;
  /** Países a revisar (defecto `['CO']`). */
  paises?: readonly CountryCode[];
  /** Movimientos con la llave del país (montos leídos en su moneda). */
  listar(creds: MasterShopCredentials, desde: Date, pais: CountryCode): Promise<{ movimientos: MovimientoBilletera[]; avisos: unknown[] }>;
  /** Aviso de saldo bajo al admin (canal pendiente; hoy registro en log y bandera en `country_settings`). */
  avisarSaldoBajo(saldo: bigint, umbral: bigint, pais: CountryCode): Promise<void>;
  /**
   * Encola `metrics.recompute_day` de los días del pedido (creación y pago, §21.4) cuando cambian su costo real
   * de envío o sus comisiones. Si falla no tumba el job: lo corrige el nocturno `metrics.recompute_recent`.
   */
  recalcularMetricas?: RecalcularMetricasPedido;
  ahora?: () => Date;
}

export interface ResultadoBilletera {
  accion: 'sin_credenciales' | 'procesado';
  movimientos: number;
  avisos: number;
  pedidos_actualizados: number;
  gastos_creados: number;
  gastos_existentes: number;
  alerta_saldo: EstadoAlertaSaldo | 'no_configurado';
  /** Con más de un país: resultado de cada uno (los contadores son la suma; `alerta_saldo` queda en `por_pais`). */
  por_pais?: Partial<Record<CountryCode, { accion: ResultadoBilletera['accion']; alerta_saldo: ResultadoBilletera['alerta_saldo'] }>>;
}

const FECHA_BOGOTA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });

/** `external_ref` del gasto de un movimiento de billetera: con país, porque cada país tiene su cuenta (D-052). */
export function refGastoBilletera(pais: CountryCode, idMovimiento: number): string {
  return `${pais}:${idMovimiento}`;
}

export function fechaBogota(iso: string): string {
  return FECHA_BOGOTA.format(new Date(iso));
}

/** Revisa cada país con su llave; un error en un país no impide revisar los demás (se relanza al final). */
export async function billeteraMasterShop(deps: DepsBilletera): Promise<ResultadoBilletera> {
  const paises = deps.paises ?? ['CO'];
  if (paises.length === 1) return billeteraPais(deps, paises[0]!);
  const total: ResultadoBilletera = {
    accion: 'sin_credenciales',
    movimientos: 0,
    avisos: 0,
    pedidos_actualizados: 0,
    gastos_creados: 0,
    gastos_existentes: 0,
    alerta_saldo: 'no_configurado',
    por_pais: {},
  };
  let fallo: unknown = null;
  for (const pais of paises) {
    let r: ResultadoBilletera;
    try {
      r = await billeteraPais(deps, pais);
    } catch (e) {
      fallo ??= e;
      continue;
    }
    total.por_pais![pais] = { accion: r.accion, alerta_saldo: r.alerta_saldo };
    for (const k of ['movimientos', 'avisos', 'pedidos_actualizados', 'gastos_creados', 'gastos_existentes'] as const) total[k] += r[k];
    if (r.accion === 'procesado') total.accion = 'procesado';
  }
  if (fallo !== null) throw fallo;
  return total;
}

async function billeteraPais(deps: DepsBilletera, pais: CountryCode): Promise<ResultadoBilletera> {
  const r: ResultadoBilletera = {
    accion: 'procesado',
    movimientos: 0,
    avisos: 0,
    pedidos_actualizados: 0,
    gastos_creados: 0,
    gastos_existentes: 0,
    alerta_saldo: 'no_configurado',
  };
  const creds = await deps.fuente.credenciales(pais);
  if (!creds) return { ...r, accion: 'sin_credenciales' };
  const ahora = (deps.ahora ?? (() => new Date()))();
  const desde = new Date(ahora.getTime() - VENTANA_BILLETERA_DIAS * 86_400_000);
  const { movimientos, avisos } = await deps.listar(creds, desde, pais);
  r.movimientos = movimientos.length;
  r.avisos = avisos.length;

  const ids = [...new Set(movimientos.flatMap((m) => (m.idOrder === null ? [] : [m.idOrder])))];
  const pedidos = ids.length === 0 ? [] : await deps.fuente.pedidosPorIdProveedor(ids, pais);
  const porId = new Map(pedidos.map((p) => [p.provider_order_id, p]));

  const porPedido = new Map<string, { pedido: PedidoBilletera; movs: MovimientoBilletera[] }>();
  for (const m of movimientos) {
    const pedido = m.idOrder === null ? undefined : porId.get(m.idOrder);
    if (pedido) {
      const g = porPedido.get(pedido.order_id) ?? { pedido, movs: [] };
      g.movs.push(m);
      porPedido.set(pedido.order_id, g);
      continue;
    }
    if (!esGastoSinPedido(m)) continue;
    const creado = await deps.fuente.registrarGasto({
      external_ref: refGastoBilletera(pais, m.id),
      ...(pais === 'CO' ? { refs_previas: [String(m.id)] } : {}),
      date: fechaBogota(m.fecha),
      amount: montoGasto(m),
      description: [m.concepto, m.idOrder !== null ? `pedido MasterShop ${m.idOrder}` : null, m.guia ? `guía ${m.guia}` : null]
        .filter(Boolean)
        .join(' · '),
    }, pais);
    if (creado) r.gastos_creados++;
    else r.gastos_existentes++;
  }

  for (const { pedido, movs } of porPedido.values()) {
    const antes = costosPedido(pedido.carrier_fees, []);
    const despues = costosPedido(pedido.carrier_fees, movs);
    if (JSON.stringify(antes.carrier_fees) === JSON.stringify(despues.carrier_fees)) continue;
    await deps.fuente.guardarCostos(pedido.order_id, despues.shipping_cost_real, despues.carrier_fees);
    r.pedidos_actualizados++;
    if (deps.recalcularMetricas) {
      try {
        await deps.recalcularMetricas(pedido.order_id);
      } catch (e) {
        console.error(`[metricas] metrics.recompute_day no encolado: ${e instanceof Error ? e.name : 'error'}`);
      }
    }
  }

  const estado = await deps.fuente.estadoSaldo(pais);
  if (estado) {
    const s = saldoMasReciente(movimientos);
    const alerta = evaluarSaldo(s?.saldo ?? null, estado.umbral, estado.alertaActiva);
    r.alerta_saldo = alerta;
    if (alerta === 'nueva' && s && estado.umbral !== null) await deps.avisarSaldoBajo(s.saldo, estado.umbral, pais);
    const activa = alerta === 'nueva' || alerta === 'activa' || (alerta === 'sin_saldo' && estado.alertaActiva);
    if (s || activa !== estado.alertaActiva) {
      await deps.fuente.guardarSaldo(s ? { valor: s.saldo, fecha: new Date(s.fecha) } : null, activa, ahora, pais);
    }
  }
  return r;
}
