/**
 * Tipos de dominio compartidos (§6.2). Los identificadores siguen el esquema de la base
 * (inglés, snake_case); los montos son `bigint` en unidad menor (regla 1).
 */
import type { CountryCode, CurrencyCode } from '../money';
import type { OrderStatus } from '../order-state';
import type { StockState } from './db-functions';

export type { CountryCode, CurrencyCode } from '../money';
export type { OrderStatus } from '../order-state';

/** Métodos que el cliente elige en el checkout (`payment_method_settings.method`). */
export const PAYMENT_METHODS = ['wompi', 'addi', 'sistecredito', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Métodos que puede tener un pedido (`orders.payment_method`, D-016 suma `manual`). */
export type OrderPaymentMethod = PaymentMethod | 'manual';

export const FINANCING_PROVIDERS = ['addi', 'sistecredito'] as const;
export type FinancingProvider = (typeof FINANCING_PROVIDERS)[number];

export function isFinancingMethod(method: string): method is FinancingProvider {
  return method === 'addi' || method === 'sistecredito';
}

/**
 * Estado de la integración de cada método (D-032). `pendiente_documentacion`: el adaptador no puede cobrar (sin
 * documentación oficial), así que el método no se ofrece ni se acepta en el checkout aunque el panel lo tenga
 * activo, y el panel no debe permitir activarlo. Se cambia aquí solo cuando el adaptador esté implementado.
 */
export const ESTADO_INTEGRACION_METODO = Object.freeze({
  wompi: 'lista',
  addi: 'lista',
  sistecredito: 'pendiente_documentacion',
  cod: 'lista',
} as const satisfies Record<PaymentMethod, 'lista' | 'pendiente_documentacion'>);
export type EstadoIntegracionMetodo = (typeof ESTADO_INTEGRACION_METODO)[PaymentMethod];

/** `true` si el método existe y su integración puede cobrar. Para el checkout y el panel (`guardarMetodo`). */
export function metodoVendible(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method) && ESTADO_INTEGRACION_METODO[method as PaymentMethod] === 'lista';
}

/** Copia de las filas de `payment_method_settings` con `is_enabled = false` en los métodos no vendibles. */
export function soloMetodosVendibles<T extends { method: string; is_enabled: boolean }>(metodos: readonly T[]): T[] {
  return metodos.map((m) => (m.is_enabled && !metodoVendible(m.method) ? { ...m, is_enabled: false } : m));
}

export type PaymentPurpose = 'full' | 'cod_deposit' | 'financing';

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'approved'
  | 'declined'
  | 'voided'
  | 'error'
  | 'expired';

export type Environment = 'sandbox' | 'production';

/**
 * Tipos de documento por país (§10.1).
 * [VERIFICAR] los códigos de Ecuador (`CEDULA`, `RUC`, `PASAPORTE`) son propios: la
 * especificación solo da los nombres; confirmar con la pasarela/transportadora de Ecuador.
 */
export const DOCUMENT_TYPES = {
  CO: ['CC', 'CE', 'NIT', 'PAS', 'TI'],
  EC: ['CEDULA', 'RUC', 'PASAPORTE'],
} as const satisfies Record<CountryCode, readonly string[]>;
export type DocumentTypeCO = (typeof DOCUMENT_TYPES.CO)[number];
export type DocumentTypeEC = (typeof DOCUMENT_TYPES.EC)[number];
export type DocumentType = DocumentTypeCO | DocumentTypeEC;

/** Línea de `order_items`. */
export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  sku: string;
  name_snapshot: string;
  variant_label: string | null;
  /** Cantidad entera > 0 (no es dinero). */
  quantity: number;
  unit_price: bigint;
  unit_compare_at: bigint | null;
  unit_cost: bigint | null;
  /** Parte del descuento del pedido asignada a esta línea (Σ = `orders.discount_amount`). */
  line_discount: bigint;
  /** Peso en kg (no es dinero). */
  weight_kg: number | null;
  mastershop_product_id: number | null;
  mastershop_variant_id: number | null;
}

/** Pedido (`orders`) con sus líneas. */
export interface Order {
  id: string;
  number: string;
  country_code: CountryCode;
  currency_code: CurrencyCode;
  customer_id: string | null;
  status: OrderStatus;
  payment_method: OrderPaymentMethod;

  contact_first_name: string;
  contact_last_name: string;
  contact_phone_e164: string;
  contact_email: string | null;
  document_type: string | null;
  document_number: string | null;

  shipping_region_id: string | null;
  shipping_city_id: string | null;
  shipping_region_name: string | null;
  shipping_city_name: string | null;
  shipping_district: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_zip: string | null;
  shipping_notes: string | null;

  subtotal: bigint;
  discount_code_id: string | null;
  discount_amount: bigint;
  /** `numeric(5,2)` como texto decimal exacto (`"10.00"`); nunca `float`. */
  financing_surcharge_pct: string;
  financing_surcharge_amount: bigint;
  total_customer: bigint;
  cod_deposit_amount: bigint;
  cod_collect_amount: bigint;

  /**
   * Copia del código usado. La controla por completo un trigger a partir de
   * `discount_code_id`: no se envía en el insert (si se envía, la base la ignora).
   */
  readonly discount_code_text: string | null;

  /** Consentimientos del checkout (§10.1 paso 6). */
  terms_accepted_at: Date | null;
  data_policy_version: string | null;
  whatsapp_opt_in: boolean;

  public_token: string;
  stock_state: StockState;
  stock_reserved_until: Date | null;
  paid_at: Date | null;
  created_at: Date;

  items: OrderItem[];
}

/** Intento de pago (`payments`). */
export interface Payment {
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
  checkout_url: string | null;
  expires_at: Date | null;
  fee_amount: bigint | null;
}
