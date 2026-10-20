/**
 * Datos que necesitan los jobs de contra entrega (dueño: izao-pagos). `flujo.ts` solo habla con esta interfaz; la
 * implementación PostgREST va aparte y las pruebas usan una en memoria. Montos `bigint` en unidad menor.
 */
import type { CountryCode, CurrencyCode } from '@izao/core/money';
import type { OrderStatus, OrderStatusEvent } from '@izao/core/order-state';
import type { PaymentStatus, StockFunctionResult, StockState } from '@izao/core/contracts';
import type { ClavePlantillaCod, CredencialesWhatsApp, PlantillaWhatsApp } from '@izao/whatsapp';
import type { WompiCredentials } from '@izao/wompi';
import type { HorarioSilencio } from './plan.js';

export interface PedidoCod {
  id: string;
  number: string;
  public_token: string;
  status: OrderStatus;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  payment_method: string;
  stock_state: StockState;
  cod_deposit_amount: bigint;
  cod_collect_amount: bigint;
  contact_first_name: string;
  contact_email: string | null;
  contact_phone_e164: string;
  created_at: Date;
  stock_reserved_until: Date | null;
}

export interface ConfigCod {
  offsetsMinutos: number[];
  silencio: HorarioSilencio;
  /** `countries.timezone` (p. ej. `America/Bogota`). */
  zona: string;
}

export interface AbonoFila {
  id: string;
  status: PaymentStatus;
  amount: bigint;
  provider_reference: string | null;
  payment_link_id: string | null;
  checkout_url: string | null;
  expires_at: Date | null;
}

export interface PayLinkFila {
  token: string;
  payment_id: string | null;
  target_url: string;
  expires_at: Date;
}

export interface MensajeFila {
  id: string;
  template_key: string;
  scheduled_for: Date | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  wa_message_id: string | null;
}

export interface FuenteCod {
  pedido(orderId: string): Promise<PedidoCod | null>;
  config(pais: CountryCode): Promise<ConfigCod | null>;
  credencialesWompi(): Promise<WompiCredentials | null>;
  credencialesWhatsApp(pais: CountryCode): Promise<CredencialesWhatsApp | null>;
  /** Pagos `wompi`/`cod_deposit` del pedido, del más antiguo al más reciente. */
  abonos(orderId: string): Promise<AbonoFila[]>;
  /** Reserva la fila antes de llamar a Wompi; `duplicado` por el índice único de `provider_reference`. */
  reservarAbono(n: {
    order_id: string;
    amount: bigint;
    currency_code: CurrencyCode;
    provider_reference: string;
    expires_at: Date;
  }): Promise<{ ok: true; id: string } | { ok: false; motivo: 'duplicado' }>;
  guardarLink(paymentId: string, link: { payment_link_id: string; checkout_url: string }): Promise<void>;
  payLink(orderId: string): Promise<PayLinkFila | null>;
  crearPayLink(p: PayLinkFila & { order_id: string }): Promise<{ ok: true } | { ok: false; motivo: 'duplicado' }>;
  /** Versión activa (`is_active`, aprobada por Meta) de la plantilla para el país. */
  plantillaActiva(pais: CountryCode, key: ClavePlantillaCod): Promise<(PlantillaWhatsApp & { id: string }) | null>;
  mensajes(orderId: string): Promise<MensajeFila[]>;
  /** Crea (o reutiliza si ya existe para esa plantilla y hora) la fila `queued` de `whatsapp_messages`. */
  prepararMensaje(m: { order_id: string; template_id: string; to_e164: string; scheduled_for: Date }): Promise<string>;
  marcarMensaje(
    id: string,
    r: { status: 'sent'; wa_message_id: string; sent_at: Date } | { status: 'failed'; error_code: string; error_text: string },
  ): Promise<void>;
  aplicarTransicion(orderId: string, evento: OrderStatusEvent, fechas?: { abandoned_at?: Date }): Promise<boolean>;
  liberarStock(orderId: string): Promise<StockFunctionResult>;
  liberarCanje(orderId: string): Promise<{ ok: boolean }>;
  registrarAlerta(orderId: string, motivo: string, payload: Record<string, string | null>): Promise<void>;
}
