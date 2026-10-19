/**
 * Interfaces de proveedores (§12.1 pagos, §14.1 transportadora) y esquema declarado
 * de credenciales (§12.1, §26.3). La lógica de negocio solo conoce estas interfaces;
 * los adaptadores viven en `packages/integrations/{proveedor}`.
 */
import type { CountryCode, CurrencyCode, Money } from '../money';
import type { Environment, Order, Payment, PaymentStatus } from './domain';

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

export type CredentialFieldKind = 'text' | 'url' | 'select';

export interface CredentialField {
  /** Clave dentro del JSON cifrado (`integration_credentials.data_encrypted`). */
  key: string;
  /** Etiqueta en español para el formulario del panel. */
  label: string;
  /** Si es secreto: se cifra, nunca vuelve al navegador ni a logs; solo vista enmascarada. */
  secret: boolean;
  required: boolean;
  kind: CredentialFieldKind;
  /** Opciones cuando `kind = 'select'`. */
  options?: readonly string[];
  help?: string;
}

/** Esquema que cada adaptador declara en `credentials.ts`. El panel genera el formulario. */
export interface CredentialSchema {
  provider: string;
  countries: readonly CountryCode[];
  environments: readonly Environment[];
  fields: readonly CredentialField[];
}

export type CredentialValues = Readonly<Record<string, string>>;

export interface CredentialValidationIssue {
  key: string;
  code: 'REQUIRED' | 'UNKNOWN_FIELD' | 'INVALID_OPTION' | 'INVALID_URL';
  message: string;
}

/** Valida valores contra el esquema. No lanza; devuelve los problemas encontrados. */
export function validateCredentials(
  schema: CredentialSchema,
  values: Readonly<Record<string, unknown>>,
): CredentialValidationIssue[] {
  const issues: CredentialValidationIssue[] = [];
  const known = new Set(schema.fields.map((f) => f.key));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      issues.push({ key, code: 'UNKNOWN_FIELD', message: `Campo desconocido: ${key}.` });
    }
  }
  for (const field of schema.fields) {
    const raw = values[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') {
      if (field.required) {
        issues.push({ key: field.key, code: 'REQUIRED', message: `${field.label} es obligatorio.` });
      }
      continue;
    }
    if (field.kind === 'select' && !(field.options ?? []).includes(value)) {
      issues.push({
        key: field.key,
        code: 'INVALID_OPTION',
        message: `${field.label} tiene un valor no permitido.`,
      });
    }
    if (field.kind === 'url' && !/^https:\/\/[^\s]+$/.test(value)) {
      issues.push({ key: field.key, code: 'INVALID_URL', message: `${field.label} debe ser https.` });
    }
  }
  return issues;
}

/**
 * Enmascara un secreto conservando solo los últimos 4 caracteres y, si existe, un prefijo
 * de tipo `prv_prod_` (§26.3: `prv_prod_****9a2f`). Secretos de menos de 12 caracteres
 * se muestran solo como `****`.
 */
export function maskSecret(value: string): string {
  if (value.length < 12) return '****';
  const prefix = /^([a-z]{2,8}_(?:[a-z]{2,8}_)?)/.exec(value)?.[1] ?? '';
  return `${prefix}****${value.slice(-4)}`;
}

/** `masked_preview` para guardar junto a la credencial cifrada. */
export function maskedPreview(
  schema: CredentialSchema,
  values: CredentialValues,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of schema.fields) {
    const v = values[field.key];
    if (v === undefined || v === '') continue;
    out[field.key] = field.secret ? maskSecret(v) : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Petición entrante tal como llegó: el cuerpo crudo es necesario para verificar firmas. */
export interface RawRequest {
  method: string;
  url: string;
  /** Cabeceras con nombre en minúsculas. */
  headers: Readonly<Record<string, string>>;
  /** Bytes exactos del cuerpo, sin parsear. */
  rawBody: Uint8Array;
}

/**
 * Evento de webhook con firma ya verificada. `event_id` es la clave de idempotencia de
 * `webhook_events (provider, event_id)`. El job NO confía en `payload` para cambiar el
 * pedido: reconsulta con `fetchStatus`.
 */
export interface VerifiedEvent {
  provider: string;
  event_id: string;
  event_type: string;
  /** Instante ISO 8601 del evento según el proveedor, si lo informa. */
  occurred_at: string | null;
  /** Referencias para asociar el evento a un `payments` sin leer el resto del cuerpo. */
  refs: {
    provider_transaction_id: string | null;
    provider_reference: string | null;
    payment_link_id: string | null;
  };
  payload: unknown;
}

/** Estado confirmado contra la API del proveedor. */
export interface ProviderStatus {
  status: PaymentStatus;
  provider_transaction_id: string | null;
  /**
   * Monto y moneda que el proveedor dice haber cobrado. El job debe compararlos con
   * `payments.amount` / `currency_code` antes de aprobar: si no coinciden, no se aprueba.
   */
  amount: bigint | null;
  currency_code: CurrencyCode | null;
  fee_amount: bigint | null;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Pagos (§12.1)
// ---------------------------------------------------------------------------

export interface PaymentProvider {
  id: 'wompi' | 'addi' | 'sistecredito' | string;
  countries: CountryCode[];
  /** Esquema declarado de credenciales (lista de campos, secretos, ambiente). */
  credentialSchema: CredentialSchema;
  createCheckout(
    order: Order,
    payment: Payment,
  ): Promise<{ redirectUrl: string; providerReference: string }>;
  createPaymentLink?(
    order: Order,
    payment: Payment,
    opts: { amount: Money; expiresAt: Date },
  ): Promise<{ linkId: string; url: string }>;
  verifyWebhook(req: RawRequest): Promise<VerifiedEvent | null>; // firma + idempotencia
  fetchStatus(payment: Payment): Promise<ProviderStatus>; // confirmación contra API
  testCredentials(creds: unknown): Promise<{ ok: boolean; message: string }>;
}

// ---------------------------------------------------------------------------
// Transportadora (§14.1)
// ---------------------------------------------------------------------------

/** Resumen de un pedido en el listado de la transportadora (`POST /api/orders/list`). */
export interface CarrierOrderSummary {
  providerOrderId: number;
  externalOrderId: string;
  statusId: number;
  statusName: string | null;
  statusParent: string | null;
  hasNovelty: boolean;
  /** Tarifa de envío informada por la transportadora, en unidad menor. */
  shippingRate: bigint | null;
  /** `totalProvider` del listado, en unidad menor. */
  totalProvider: bigint | null;
  updatedAt: string | null;
}

/** Pedido completo de la transportadora, incluye guía y etiqueta. */
export interface CarrierOrder extends CarrierOrderSummary {
  carrierName: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  alerts: unknown[];
  raw: unknown;
}

export interface CarrierProvider {
  id: 'mastershop' | string;
  createOrder(order: Order): Promise<{ providerOrderId: number; statusId: number }>;
  confirmOrder(providerOrderId: number): Promise<void>;
  getOrder(ref: { externalOrderId?: string; providerOrderId?: number }): Promise<CarrierOrder>; // incluye guía y etiqueta
  listOrders(filter: { startDate: Date; page: number }): Promise<CarrierOrderSummary[]>;
  cancelOrder(providerOrderId: number): Promise<void>;
  testCredentials(creds: unknown): Promise<{ ok: boolean; message: string }>;
}
