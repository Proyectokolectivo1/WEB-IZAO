/**
 * Datos que necesita el job de pagos (dueño: izao-pagos). La lógica (`wompi-transaccion.ts`) solo habla con
 * esta interfaz; `fuente-postgrest.ts` la implementa contra Supabase con la llave de servidor y las pruebas con
 * una fuente en memoria. Montos `bigint` en unidad menor.
 */
import type { CountryCode, CurrencyCode } from '@izao/core/money';
import type { OrderStatus, OrderStatusEvent } from '@izao/core/order-state';
import type {
  ConfirmRedemptionResult,
  PaymentPurpose,
  PaymentStatus,
  StockFunctionResult,
  StockState,
} from '@izao/core/contracts';
import type { ComisionConfig } from '@izao/core/pricing';
import type { WompiCredentials } from '@izao/wompi';

export interface PagoFila {
  id: string;
  order_id: string;
  provider: string;
  purpose: PaymentPurpose;
  amount: bigint;
  currency_code: CurrencyCode;
  status: PaymentStatus;
  provider_reference: string | null;
  provider_transaction_id: string | null;
  payment_link_id: string | null;
  /** ISO 8601; ordena los intentos. */
  created_at: string;
}

export interface PedidoFila {
  id: string;
  number: string;
  status: OrderStatus;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  payment_method: string;
  stock_state: StockState;
}

export interface CambiosPago {
  status: PaymentStatus;
  provider_transaction_id: string;
  fee_amount: bigint | null;
  raw_last_event: unknown;
}

export type ResultadoWebhook = { ok: true } | { ok: false; error: string };

export interface FuentePagosWorker {
  /** Credenciales activas de Wompi para CO, ya descifradas; `null` si no hay o están mal. */
  credencialesWompi(): Promise<WompiCredentials | null>;
  /** Pagos del proveedor de la fuente (Wompi o Addi) con esa referencia, del más antiguo al más reciente. */
  pagosPorReferencia(referencia: string): Promise<PagoFila[]>;
  pagosPorLink(linkId: string): Promise<PagoFila[]>;
  /** Pagos del proveedor de la fuente del pedido, del más antiguo al más reciente. */
  pagosDelPedido(orderId: string): Promise<PagoFila[]>;
  pedido(orderId: string): Promise<PedidoFila | null>;
  actualizarPago(id: string, cambios: CambiosPago): Promise<void>;
  comision(pais: CountryCode, metodo: string): Promise<ComisionConfig | null>;
  confirmarStock(orderId: string): Promise<StockFunctionResult>;
  confirmarCanje(orderId: string): Promise<ConfirmRedemptionResult>;
  /**
   * Aplica un evento de `transicionar` con `aplicar_transicion_pedido` (atómico): cambia `orders.status` solo si
   * sigue en `from_status` y registra el evento. `true` también si ya estaba en `to_status` (reintento); `false`
   * si otro proceso lo movió a otro estado (no escribe nada). Lanza si el pedido no existe o los datos no cuadran.
   */
  aplicarTransicion(orderId: string, evento: OrderStatusEvent, opciones?: { paid_at?: Date }): Promise<boolean>;
  /** Evento `alerta` en `order_events` para el panel (pago duplicado, monto distinto, sin stock…). */
  registrarAlerta(orderId: string, motivo: string, payload: Record<string, string | null>): Promise<void>;
  marcarWebhook(eventId: string, resultado: ResultadoWebhook): Promise<void>;
}

/** Lo que usa el job de callbacks de financiación (Addi): sin credenciales de Wompi ni links de pago. */
export type FuenteFinanciacionWorker = Omit<FuentePagosWorker, 'credencialesWompi' | 'pagosPorLink'>;
