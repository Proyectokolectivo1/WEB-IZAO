/**
 * Barrido cron `pedidos.barrido` (dueño: izao-pagos; §12.2, §13.1, T1.15). Red de seguridad de los jobs puntuales:
 *   0. Conciliación con la API de Wompi (`../payments/conciliacion.ts`, D-059): primero se aplican los pagos que
 *      Wompi ya aprobó aunque el webhook no haya llegado. Antes de vencer un pedido se concilian sus pagos; si Wompi
 *      no responde, el vencimiento se pospone hasta `MAX_POSPONER_MS` después de la reserva (luego expira con motivo
 *      `reserva_vencida_sin_conciliar`; un pago tardío aprobado lo reactiva en `wompi-transaccion`).
 *   1. `pedidos_por_vencer`: `pendiente_pago`/`pendiente_manual` → `expirado`, `esperando_abono` → `abandonado`;
 *      libera stock y canje. El pedido se relee y la transición pasa por `transicionar` + `aplicar_transicion_pedido`
 *      (condicional por estado: un pago que llegó en medio gana). Un pago completo aprobado después se reactiva si hay
 *      stock (o `requiere_reembolso`) y el abono tardío igual, en `wompi-transaccion`.
 *   2. Reservas huérfanas (`expirado`/`abandonado` con stock reservado): se liberan (las funciones son idempotentes).
 *   3. Contra entrega en `esperando_abono` sin `pay_links` (Redis caído en el checkout): encola `cod.iniciar` con el
 *      mismo id fijo del checkout, así sigue habiendo un solo creador del link.
 *   4. Solicitudes de Addi abiertas (`created`/`pending`) de pedidos `expirado` → `expired` en la base, condicional al
 *      estado (D-040). Addi no permite cancelar una solicitud pendiente, así que no se llama a su API: si Addi aprueba
 *      después, `addi.callback` deja el pedido en `requiere_reembolso` con alerta `pago_tardio`. Un fallo se reintenta
 *      solo en la siguiente corrida (la consulta lo vuelve a encontrar).
 * El arranque (izao-infra) lo registra en la cola `sistema` con `CRON_BARRIDO_PEDIDOS` (cada 2 minutos):
 *   case JOB_BARRIDO_PEDIDOS: return barrerPedidos(dependenciasBarridoDesdeEnv(colaCod));
 */
import { Queue } from 'bullmq';
import { transicionar, type OrderStatus } from '@izao/core/order-state';
import { COLA_CARRIER } from '@izao/mastershop';
import { crearClienteWompi } from '@izao/wompi';
import { JOB_COD_INICIAR, jobIdCodIniciar, type DatosJobCodIniciar } from '@izao/whatsapp';
import { encolarTransportadora } from '../carrier/index.js';
import { crearConciliadorWompi, type ConciliadorWompi, type ResultadoConciliacion } from '../payments/conciliacion.js';
import { crearFuentePostgrest } from '../payments/fuente-postgrest.js';
import { crearFuenteCodPostgrest } from './fuente-postgrest.js';
import { conRecalculoMetricas, type RecalcularMetricasPedido } from '../metrics/tras-transicion.js';
import type { FuenteBarrido, FuenteCod, PedidoPorVencer } from './fuente.js';
import { programadorCod } from './index.js';

export const JOB_BARRIDO_PEDIDOS = 'pedidos.barrido';
/** Patrón cron (zona del negocio America/Bogota). Debe coincidir con `INTERVALO_CONCILIACION_MS`. */
export const CRON_BARRIDO_PEDIDOS = '*/2 * * * *';

const LIMITE = 200;
/** Pedidos más nuevos que esto todavía pueden estar encolándose desde el checkout. */
const GRACIA_SIN_LINK_MS = 2 * 60_000;
const ACTOR = 'system';
/** Máximo que se pospone vencer un pedido cuyo pago Wompi no se pudo conciliar (Wompi caído). */
export const MAX_POSPONER_MS = 60 * 60_000;

export type ResultadoEncolado = 'encolado' | 'reintentado' | 'existente';

export interface DepsBarrido {
  fuente: FuenteBarrido & Pick<FuenteCod, 'pedido' | 'aplicarTransicion' | 'liberarStock' | 'liberarCanje'>;
  encolarInicioCod: (orderId: string) => Promise<ResultadoEncolado>;
  /** Optimización: el abandono programado igual se omite al releer el estado. */
  cancelarJobsCod?: (orderId: string) => Promise<void>;
  /** Programa `cod.aviso_cancelacion` (id fijo por pedido) cuando el barrido abandona un pedido contra entrega. */
  programarAvisoCancelacion?: (orderId: string, en: Date) => Promise<void>;
  /** Conciliación con Wompi (D-059); uno nuevo por corrida (memoriza lo consultado en ella). */
  conciliador?: ConciliadorWompi;
  ahora?: () => Date;
}

export interface ResultadoBarrido {
  vencidos: number;
  liberados: number;
  encolados: number;
  /** Solicitudes de financiación marcadas `expired` en esta corrida. */
  invalidadas: number;
  omitidos: number;
  /** Vencimientos pospuestos porque Wompi no respondió al conciliar el pago del pedido. */
  pospuestos: number;
  errores: number;
  conciliacion?: ResultadoConciliacion;
}

const ESTADOS_VENCIBLES = new Set<OrderStatus>(['pendiente_pago', 'pago_rechazado', 'pendiente_manual', 'esperando_abono']);

async function liberar(deps: DepsBarrido, orderId: string): Promise<void> {
  const stock = await deps.fuente.liberarStock(orderId);
  if (!stock.ok) throw new Error('liberar_stock no liberó');
  await deps.fuente.liberarCanje(orderId);
}

type Vencimiento = 'vencido' | 'omitido' | 'pospuesto';

async function vencer(deps: DepsBarrido, f: PedidoPorVencer, ahora: Date): Promise<Vencimiento> {
  const p = await deps.fuente.pedido(f.order_id);
  if (!p || p.status !== f.estado_actual || !ESTADOS_VENCIBLES.has(p.status)) return 'omitido';
  if (!p.stock_reserved_until || p.stock_reserved_until.getTime() > ahora.getTime()) return 'omitido';
  const desde = p.status;
  let motivo = 'reserva_vencida';
  if (deps.conciliador) {
    // Nunca expirar un pedido pagado: primero se pregunta a Wompi (el webhook pudo no llegar).
    if ((await deps.conciliador.conciliarPedido(p.id)) === 'fallo') {
      if (ahora.getTime() - p.stock_reserved_until.getTime() < MAX_POSPONER_MS) return 'pospuesto';
      motivo = 'reserva_vencida_sin_conciliar';
    }
    const actual = await deps.fuente.pedido(p.id);
    if (!actual || actual.status !== desde) return 'omitido';
  }
  const t = transicionar({ from: desde, to: f.nuevo_estado, actor: ACTOR, payload: { motivo } });
  if (!t.ok) {
    console.error(`[worker] barrido: transición no permitida ${desde}→${f.nuevo_estado} (pedido ${p.id})`);
    return 'omitido';
  }
  const fechas = f.nuevo_estado === 'abandonado' ? { abandoned_at: ahora } : undefined;
  if (!(await deps.fuente.aplicarTransicion(p.id, t.event, fechas))) return 'omitido';
  if (desde === 'esperando_abono' && deps.cancelarJobsCod) await deps.cancelarJobsCod(p.id).catch(() => undefined);
  if (f.nuevo_estado === 'abandonado' && deps.programarAvisoCancelacion) {
    // Best effort: nunca bloquea liberar el stock.
    await deps.programarAvisoCancelacion(p.id, ahora).catch(() => console.error(`[worker] barrido: aviso de cancelación sin programar (pedido ${p.id})`));
  }
  await liberar(deps, p.id);
  return 'vencido';
}

export async function barrerPedidos(deps: DepsBarrido): Promise<ResultadoBarrido> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const r: ResultadoBarrido = { vencidos: 0, liberados: 0, encolados: 0, invalidadas: 0, omitidos: 0, pospuestos: 0, errores: 0 };
  const fallo = (paso: string, id: string, e: unknown) => {
    r.errores += 1;
    console.error(`[worker] barrido ${paso} falló (pedido ${id}): ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
  };

  if (deps.conciliador) {
    try {
      r.conciliacion = await deps.conciliador.barrer();
    } catch (e) {
      fallo('conciliar Wompi', '-', e);
    }
  }
  for (const f of await deps.fuente.pedidosPorVencer(ahora, LIMITE)) {
    try {
      const v = await vencer(deps, f, ahora);
      if (v === 'vencido') r.vencidos += 1;
      else if (v === 'pospuesto') r.pospuestos += 1;
      else r.omitidos += 1;
    } catch (e) {
      fallo('vencer', f.order_id, e);
    }
  }
  for (const id of await deps.fuente.reservasHuerfanas(LIMITE)) {
    try {
      await liberar(deps, id);
      r.liberados += 1;
    } catch (e) {
      fallo('liberar', id, e);
    }
  }
  for (const id of await deps.fuente.pedidosSinLink(new Date(ahora.getTime() - GRACIA_SIN_LINK_MS), ahora, LIMITE)) {
    try {
      if ((await deps.encolarInicioCod(id)) !== 'existente') r.encolados += 1;
    } catch (e) {
      fallo('encolar', id, e);
    }
  }
  // Después de vencer: las de esta misma corrida ya aparecen como `expirado`.
  for (const sol of await deps.fuente.solicitudesFinanciacionVencidas(LIMITE)) {
    try {
      if (await deps.fuente.invalidarSolicitudFinanciacion(sol.payment_id)) r.invalidadas += 1;
    } catch (e) {
      fallo('invalidar solicitud', sol.order_id, e);
    }
  }
  if (r.vencidos + r.liberados + r.encolados + r.invalidadas + r.pospuestos + r.errores > 0) {
    console.log(`[worker] ${JOB_BARRIDO_PEDIDOS}: ${JSON.stringify(r)}`);
  }
  return r;
}

/** Igual que `encolarInicioCod` del checkout: id fijo; si el anterior falló se reintenta; si existe, nada. */
export function encoladorInicioCod(cola: Pick<Queue, 'getJob' | 'add'>): DepsBarrido['encolarInicioCod'] {
  return async (orderId) => {
    const jobId = jobIdCodIniciar(orderId);
    const previo = await cola.getJob(jobId);
    if (previo) {
      if (await previo.isFailed()) {
        await previo.retry();
        return 'reintentado';
      }
      return 'existente';
    }
    const datos: DatosJobCodIniciar = { order_id: orderId };
    await cola.add(JOB_COD_INICIAR, datos, {
      jobId,
      attempts: 8,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
    return 'encolado';
  };
}

/** Una cola `carrier` por conexión de Redis, reutilizada entre corridas (las dependencias se arman en cada una). */
const colasCarrier = new WeakMap<object, Queue>();
function colaCarrierDe(colaCod: Queue): Queue {
  const conexion = colaCod.opts.connection as object;
  let c = colasCarrier.get(conexion);
  if (!c) {
    c = new Queue(COLA_CARRIER, { connection: colaCod.opts.connection });
    colasCarrier.set(conexion, c);
  }
  return c;
}

/**
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY. `colaCod` = cola `contraentrega`.
 * Incluye la conciliación con Wompi (D-059) por el mismo camino del job `wompi.transaccion`: fuente de pagos con el
 * mismo enganche de métricas/CAPI, cliente con la llave privada descifrada, `carrier.create` (id fijo por pedido) y
 * cancelación de los jobs de contra entrega.
 */
export function dependenciasBarridoDesdeEnv(
  colaCod: Queue,
  cancelarJobsCod?: (orderId: string) => Promise<void>,
  /** Encola `metrics.recompute_day` (y Purchase de CAPI) tras cada transición aplicada. */
  recalcularMetricas?: RecalcularMetricasPedido,
): DepsBarrido {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para el barrido de pedidos');
  }
  const o = { supabaseUrl, secretKey, claveCifrado };
  const conciliador = crearConciliadorWompi({
    fuente: conRecalculoMetricas(crearFuentePostgrest(o), recalcularMetricas),
    cliente: (c) => crearClienteWompi({ ambiente: c.ambiente, llavePrivada: c.llavePrivada }),
    encolarTransportadora: encolarTransportadora(colaCarrierDe(colaCod)),
    cancelarJobsCod: cancelarJobsCod ?? (async () => {}),
  });
  return {
    fuente: conRecalculoMetricas(crearFuenteCodPostgrest(o), recalcularMetricas),
    encolarInicioCod: encoladorInicioCod(colaCod),
    ...(cancelarJobsCod ? { cancelarJobsCod } : {}),
    programarAvisoCancelacion: (orderId, en) => programadorCod(colaCod)({ tipo: 'aviso_cancelacion', order_id: orderId, en }),
    conciliador,
  };
}
