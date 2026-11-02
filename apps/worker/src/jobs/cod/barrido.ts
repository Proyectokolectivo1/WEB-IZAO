/**
 * Barrido cron `pedidos.barrido` (dueño: izao-pagos; §12.2, §13.1, T1.15). Red de seguridad de los jobs puntuales:
 *   1. `pedidos_por_vencer`: `pendiente_pago`/`pendiente_manual` → `expirado`, `esperando_abono` → `abandonado`;
 *      libera stock y canje. El pedido se relee y la transición pasa por `transicionar` + `aplicar_transicion_pedido`
 *      (condicional por estado: un pago que llegó en medio gana). Un pago aprobado después cae en
 *      `requiere_reembolso` (o se reactiva el abono) en `wompi-transaccion`.
 *   2. Reservas huérfanas (`expirado`/`abandonado` con stock reservado): se liberan (las funciones son idempotentes).
 *   3. Contra entrega en `esperando_abono` sin `pay_links` (Redis caído en el checkout): encola `cod.iniciar` con el
 *      mismo id fijo del checkout, así sigue habiendo un solo creador del link.
 *   4. Solicitudes de Addi abiertas (`created`/`pending`) de pedidos `expirado` → `expired` en la base, condicional al
 *      estado (D-040). Addi no permite cancelar una solicitud pendiente, así que no se llama a su API: si Addi aprueba
 *      después, `addi.callback` deja el pedido en `requiere_reembolso` con alerta `pago_tardio`. Un fallo se reintenta
 *      solo en la siguiente corrida (la consulta lo vuelve a encontrar).
 * El arranque (izao-infra) lo registra en la cola `sistema` cada 5 minutos:
 *   case JOB_BARRIDO_PEDIDOS: return barrerPedidos(dependenciasBarridoDesdeEnv(colaCod));
 */
import type { Queue } from 'bullmq';
import { transicionar, type OrderStatus } from '@izao/core/order-state';
import { JOB_COD_INICIAR, jobIdCodIniciar, type DatosJobCodIniciar } from '@izao/whatsapp';
import { crearFuenteCodPostgrest } from './fuente-postgrest.js';
import { conRecalculoMetricas, type RecalcularMetricasPedido } from '../metrics/tras-transicion.js';
import type { FuenteBarrido, FuenteCod, PedidoPorVencer } from './fuente.js';

export const JOB_BARRIDO_PEDIDOS = 'pedidos.barrido';
/** Patrón cron sugerido (zona del negocio America/Bogota). */
export const CRON_BARRIDO_PEDIDOS = '*/5 * * * *';

const LIMITE = 200;
/** Pedidos más nuevos que esto todavía pueden estar encolándose desde el checkout. */
const GRACIA_SIN_LINK_MS = 2 * 60_000;
const ACTOR = 'system';

export type ResultadoEncolado = 'encolado' | 'reintentado' | 'existente';

export interface DepsBarrido {
  fuente: FuenteBarrido & Pick<FuenteCod, 'pedido' | 'aplicarTransicion' | 'liberarStock' | 'liberarCanje'>;
  encolarInicioCod: (orderId: string) => Promise<ResultadoEncolado>;
  /** Optimización: el abandono programado igual se omite al releer el estado. */
  cancelarJobsCod?: (orderId: string) => Promise<void>;
  ahora?: () => Date;
}

export interface ResultadoBarrido {
  vencidos: number;
  liberados: number;
  encolados: number;
  /** Solicitudes de financiación marcadas `expired` en esta corrida. */
  invalidadas: number;
  omitidos: number;
  errores: number;
}

const ESTADOS_VENCIBLES = new Set<OrderStatus>(['pendiente_pago', 'pago_rechazado', 'pendiente_manual', 'esperando_abono']);

async function liberar(deps: DepsBarrido, orderId: string): Promise<void> {
  const stock = await deps.fuente.liberarStock(orderId);
  if (!stock.ok) throw new Error('liberar_stock no liberó');
  await deps.fuente.liberarCanje(orderId);
}

async function vencer(deps: DepsBarrido, f: PedidoPorVencer, ahora: Date): Promise<boolean> {
  const p = await deps.fuente.pedido(f.order_id);
  if (!p || p.status !== f.estado_actual || !ESTADOS_VENCIBLES.has(p.status)) return false;
  if (!p.stock_reserved_until || p.stock_reserved_until.getTime() > ahora.getTime()) return false;
  const desde = p.status;
  const t = transicionar({ from: desde, to: f.nuevo_estado, actor: ACTOR, payload: { motivo: 'reserva_vencida' } });
  if (!t.ok) {
    console.error(`[worker] barrido: transición no permitida ${desde}→${f.nuevo_estado} (pedido ${p.id})`);
    return false;
  }
  const fechas = f.nuevo_estado === 'abandonado' ? { abandoned_at: ahora } : undefined;
  if (!(await deps.fuente.aplicarTransicion(p.id, t.event, fechas))) return false;
  if (desde === 'esperando_abono' && deps.cancelarJobsCod) await deps.cancelarJobsCod(p.id).catch(() => undefined);
  await liberar(deps, p.id);
  return true;
}

export async function barrerPedidos(deps: DepsBarrido): Promise<ResultadoBarrido> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const r: ResultadoBarrido = { vencidos: 0, liberados: 0, encolados: 0, invalidadas: 0, omitidos: 0, errores: 0 };
  const fallo = (paso: string, id: string, e: unknown) => {
    r.errores += 1;
    console.error(`[worker] barrido ${paso} falló (pedido ${id}): ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
  };

  for (const f of await deps.fuente.pedidosPorVencer(ahora, LIMITE)) {
    try {
      if (await vencer(deps, f, ahora)) r.vencidos += 1;
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
  if (r.vencidos + r.liberados + r.encolados + r.invalidadas + r.errores > 0) console.log(`[worker] ${JOB_BARRIDO_PEDIDOS}: ${JSON.stringify(r)}`);
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

/** Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY. `colaCod` = cola `contraentrega`. */
export function dependenciasBarridoDesdeEnv(
  colaCod: Queue,
  cancelarJobsCod?: (orderId: string) => Promise<void>,
  /** Encola `metrics.recompute_day` tras cada transición aplicada (expirado, abandonado). */
  recalcularMetricas?: RecalcularMetricasPedido,
): DepsBarrido {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const claveCifrado = process.env.APP_ENCRYPTION_KEY;
  if (!supabaseUrl || !secretKey || !claveCifrado) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_SECRET_KEY o APP_ENCRYPTION_KEY para el barrido de pedidos');
  }
  return {
    fuente: conRecalculoMetricas(crearFuenteCodPostgrest({ supabaseUrl, secretKey, claveCifrado }), recalcularMetricas),
    encolarInicioCod: encoladorInicioCod(colaCod),
    ...(cancelarJobsCod ? { cancelarJobsCod } : {}),
  };
}
