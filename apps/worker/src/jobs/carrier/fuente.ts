/**
 * Datos que necesitan los jobs de la cola `carrier` (dueño: izao-logistica). La lógica (`crear.ts`,
 * `etiqueta.ts`, `sincronizar.ts`) solo habla con esta interfaz; `fuente-postgrest.ts` la implementa
 * contra Supabase con la llave de servidor y las pruebas con `fuente-memoria.ts`.
 */
import type { CountryCode } from '@izao/core/money';
import type { Order } from '@izao/core/contracts';
import type { OrderStatusEvent } from '@izao/core/order-state';
import type { CarrierDiscountMode, MasterShopCredentials } from '@izao/mastershop';

export interface AjustesTransportadora {
  /** `country_settings.carrier_provider`; `null` = el país no usa transportadora integrada. */
  proveedor: 'mastershop' | null;
  autoConfirmar: boolean;
  modo: CarrierDiscountMode;
}

/** Pago aprobado más reciente del pedido, para `payment_gateway` y `notes`. */
export interface PagoAprobado {
  provider: string;
  referencia: string | null;
}

/** Fila de `shipments` (solo lo que usan los jobs). Montos en unidad menor. */
export interface EnvioFila {
  id: string;
  order_id: string;
  external_order_id: string;
  provider_order_id: number | null;
  provider_status_id: number | null;
  tracking_code: string | null;
  label_url: string | null;
  label_local_path: string | null;
  /** Tarifa de envío que reporta MasterShop (entra en las métricas como costo estimado). */
  shipping_rate?: bigint | null;
}

export interface CambiosEnvio {
  external_order_id: string;
  provider_order_id?: number;
  provider_status_id?: number;
  provider_status_name?: string | null;
  provider_status_parent?: string | null;
  carrier_name?: string | null;
  tracking_code?: string | null;
  tracking_url?: string | null;
  label_url?: string | null;
  label_local_path?: string | null;
  has_novelty?: boolean;
  alerts?: unknown[];
  shipping_rate?: bigint | null;
  total_provider?: bigint | null;
  last_synced_at?: Date;
  /** Se agrega al final de `status_history` si el estado cambió. */
  historial?: { id_status: number; at: string; origen: string };
}

export type ResultadoWebhook = { ok: true } | { ok: false; error: string };

export interface FuenteCarrier {
  /** Pedido con sus líneas (snapshot con vínculos de MasterShop); `null` si no existe. */
  pedido(orderId: string): Promise<Order | null>;
  /** Id del pedido por `orders.number` (= `externalOrderId`). */
  pedidoPorNumero(numero: string): Promise<string | null>;
  /** Id del pedido por `shipments.provider_order_id`. */
  pedidoPorIdProveedor(providerOrderId: number): Promise<string | null>;
  ajustes(pais: CountryCode): Promise<AjustesTransportadora | null>;
  pagoAprobado(orderId: string): Promise<PagoAprobado | null>;
  /**
   * Credencial activa de MasterShop del país del pedido, descifrada; `null` si no hay o falla. Cada país tiene
   * su propia llave (D-052): nunca se usa la de otro país.
   */
  credenciales(pais: CountryCode): Promise<MasterShopCredentials | null>;
  envio(orderId: string): Promise<EnvioFila | null>;
  /** Upsert por `(order_id, provider)`; devuelve la fila resultante. */
  guardarEnvio(orderId: string, cambios: CambiosEnvio): Promise<EnvioFila>;
  /** `aplicar_transicion_pedido`: `true` si quedó aplicada (o ya estaba), `false` si otro proceso la movió. */
  aplicarTransicion(orderId: string, evento: OrderStatusEvent, fechas?: Record<string, Date | undefined>): Promise<boolean>;
  /** Evento en `order_events` (`type` libre: `alerta`, `transportadora`). */
  registrarEvento(orderId: string, tipo: 'alerta' | 'transportadora', actor: string, payload: Record<string, unknown>): Promise<void>;
  /** `print_jobs` de tipo `label` para el envío, si no hay ya uno no cancelado. Devuelve si lo creó. */
  crearImpresionEtiqueta(orderId: string, shipmentId: string): Promise<boolean>;
  marcarWebhook(eventId: string, resultado: ResultadoWebhook): Promise<void>;
}

/** Programa jobs de la cola `carrier` (implementación BullMQ en `index.ts`). */
export interface ProgramadorCarrier {
  crear(orderId: string, intento: number, esperaMs: number): Promise<void>;
  etiqueta(orderId: string, intento: number, esperaMs: number): Promise<void>;
}

/** Descarga la etiqueta y la guarda en `MEDIA_ROOT/labels/`; devuelve la ruta relativa a `MEDIA_ROOT`. */
export interface AlmacenEtiquetas {
  guardar(url: string, numeroPedido: string): Promise<string>;
}
