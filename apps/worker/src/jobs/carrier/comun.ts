/**
 * Piezas comunes de los jobs de la cola `carrier`: dependencias, transición de estado con `transicionar`
 * + `aplicar_transicion_pedido`, actualización de `shipments` desde la API y guardado de la etiqueta.
 */
import type { CarrierOrder, CarrierProvider } from '@izao/core/contracts';
import type { CountryCode } from '@izao/core/money';
import { transicionar, type JsonValue, type OrderStatus } from '@izao/core/order-state';
import {
  CarrierOrderError,
  isMasterShopError,
  type CarrierOrderOptions,
  type MasterShopCredentials,
} from '@izao/mastershop';
import { esBloqueoEtiqueta } from './almacen-etiquetas.js';
import type { RecalcularMetricasPedido } from '../metrics/tras-transicion.js';
import type { AlmacenEtiquetas, EnvioFila, FuenteCarrier, ProgramadorCarrier } from './fuente.js';

export interface DepsCarrier {
  fuente: FuenteCarrier;
  /**
   * Adaptador `CarrierProvider` con esa llave. `opciones` (modo A/B y pago) solo hacen falta para crear;
   * sin ellas, `createOrder` debe fallar.
   */
  transportadora(creds: MasterShopCredentials, opciones: CarrierOrderOptions | undefined, pais: CountryCode): CarrierProvider;
  programar: ProgramadorCarrier;
  etiquetas: AlmacenEtiquetas;
  /**
   * Encola `metrics.recompute_day` de los días del pedido (§21.4). Las transiciones ya lo disparan porque
   * `dependenciasCarrierDesdeEnv` envuelve la fuente con `conRecalculoMetricas`; aquí queda para los cambios
   * que no pasan por una transición (la tarifa del envío que trae la sincronización).
   */
  recalcularMetricas?: RecalcularMetricasPedido;
  ahora?: () => Date;
}

/** Recálculo que nunca tumba el job: si falla, lo corrige el nocturno `metrics.recompute_recent`. */
export async function recalcularMetricasSeguro(deps: DepsCarrier, orderId: string): Promise<void> {
  if (!deps.recalcularMetricas) return;
  try {
    await deps.recalcularMetricas(orderId);
  } catch (e) {
    console.error(`[metricas] metrics.recompute_day no encolado: ${e instanceof Error ? e.name : 'error'}`);
  }
}

export const ACTOR_SISTEMA = 'system';
export const ACTOR_WEBHOOK = 'webhook:mastershop';

/** Estados internos que aún pueden recibir la etiqueta. */
export const ESPERAN_ETIQUETA: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'enviado_transportadora',
  'en_preparacion',
  'en_transito',
]);

/** Fechas de `orders` que fija cada estado destino. */
function fechasPara(to: OrderStatus, ahora: Date): Record<string, Date> {
  if (to === 'enviado_transportadora') return { sent_to_carrier_at: ahora };
  if (to === 'entregado') return { delivered_at: ahora };
  if (to === 'cancelado') return { cancelled_at: ahora };
  return {};
}

export type ResultadoMover = 'aplicada' | 'movido_por_otro' | 'invalida';

/** Un paso de estado: valida con `transicionar` y aplica condicionado al estado leído. */
export async function mover(
  deps: DepsCarrier,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  actor: string,
  payload: Record<string, JsonValue>,
): Promise<ResultadoMover> {
  const t = transicionar({ from, to, actor, payload });
  if (!t.ok) return 'invalida';
  const ahora = (deps.ahora ?? (() => new Date()))();
  const ok = await deps.fuente.aplicarTransicion(orderId, t.event, fechasPara(to, ahora));
  return ok ? 'aplicada' : 'movido_por_otro';
}

/** Forma segura del error para `order_events` (sin llaves: el cliente ya las redacta). */
export function errorParaEvento(e: unknown): Record<string, unknown> {
  if (isMasterShopError(e)) return e.toJSON();
  if (e instanceof CarrierOrderError) return { name: e.name, message: e.message, issues: e.issues as unknown };
  if (e instanceof Error) return { name: e.name, message: e.message.slice(0, 300) };
  return { name: 'error' };
}

/** `true` si conviene reintentar más tarde (red, 5xx, 429, edición concurrente o fallo propio). */
export function esReintentable(e: unknown): boolean {
  if (isMasterShopError(e)) return e.retryable;
  if (e instanceof CarrierOrderError) return false;
  return true;
}

/** Copia a `shipments` lo que dice la API (guía, rastreo, etiqueta, novedad, tarifas). */
export async function guardarRemoto(
  deps: DepsCarrier,
  orderId: string,
  numero: string,
  previo: EnvioFila | null,
  remoto: CarrierOrder,
  origen: string,
): Promise<EnvioFila> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const cambio = previo?.provider_status_id !== remoto.statusId;
  return deps.fuente.guardarEnvio(orderId, {
    external_order_id: numero,
    provider_order_id: remoto.providerOrderId,
    provider_status_id: remoto.statusId,
    provider_status_name: remoto.statusName,
    provider_status_parent: remoto.statusParent,
    carrier_name: remoto.carrierName,
    tracking_code: remoto.trackingCode,
    tracking_url: remoto.trackingUrl,
    label_url: remoto.labelUrl,
    has_novelty: remoto.hasNovelty,
    alerts: remoto.alerts,
    shipping_rate: remoto.shippingRate,
    total_provider: remoto.totalProvider,
    last_synced_at: ahora,
    ...(cambio ? { historial: { id_status: remoto.statusId, at: ahora.toISOString(), origen } } : {}),
  });
}

/**
 * Descarga la etiqueta a `MEDIA_ROOT/labels/`, guarda la ruta y crea el `print_job` (§14.5 paso 3).
 * Idempotente: si ya hay ruta local solo asegura el trabajo de impresión.
 *
 * Respaldo D-051: si el CDN bloquea la IP del servidor (403), no es un error terminal. Se crea igual el `print_job`
 * y el agente descarga el PDF desde `shipments.label_url` (API del agente v1.1). La copia local se vuelve a intentar
 * en cada sincronización; el trabajo automático sigue siendo uno por envío.
 */
export async function guardarEtiqueta(
  deps: DepsCarrier,
  orderId: string,
  numero: string,
  envio: EnvioFila,
  actor: string,
): Promise<'guardada' | 'ya_guardada' | 'sin_etiqueta' | 'remota'> {
  if (envio.label_local_path) {
    await deps.fuente.crearImpresionEtiqueta(orderId, envio.id);
    return 'ya_guardada';
  }
  if (!envio.label_url) return 'sin_etiqueta';
  let ruta: string;
  try {
    ruta = await deps.etiquetas.guardar(envio.label_url, numero);
  } catch (e) {
    if (!esBloqueoEtiqueta(e)) throw e;
    const creado = await deps.fuente.crearImpresionEtiqueta(orderId, envio.id);
    if (creado) {
      await deps.fuente.registrarEvento(orderId, 'transportadora', actor, {
        accion: 'etiqueta_por_agente',
        guia: envio.tracking_code,
        motivo: 'cdn_bloquea_servidor',
        error: errorParaEvento(e),
        impresion_creada: true,
      });
    }
    return 'remota';
  }
  const actualizado = await deps.fuente.guardarEnvio(orderId, { external_order_id: numero, label_local_path: ruta });
  const creado = await deps.fuente.crearImpresionEtiqueta(orderId, actualizado.id);
  await deps.fuente.registrarEvento(orderId, 'transportadora', actor, {
    accion: 'etiqueta_guardada',
    guia: envio.tracking_code,
    ruta,
    impresion_creada: creado,
  });
  return 'guardada';
}
