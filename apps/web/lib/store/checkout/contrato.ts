/**
 * Contrato de creación del pedido con el servidor (dueño: izao-pagos, `apps/web/app/api/checkout/route.ts`,
 * commit 3a7e66b; tipos en `lib/checkout/crear-pedido.ts`).
 *
 * `POST /api/checkout`
 *   cuerpo:    `CheckoutInput` crudo de `@izao/core/schemas` (country_code, idempotency_key, items[{variant_id, quantity}],
 *              contact, document, shipping, payment_method, discount_code, consents, data_policy_version).
 *              Nunca viajan precios ni totales (regla 2): el servidor recalcula todo.
 *   200 (repite) / 201 (crea): { order, public_token, next_step, status_path, repeated, warnings }
 *   error: { error, issues?: [{ path, message }], lines?: [{ variant_id, max_quantity }], reason?, missing_amount? }
 *     400 INVALID_INPUT · 409 STOCK_CHANGED | IDEMPOTENCY_CONFLICT | CHECKOUT_IN_PROGRESS | DATA_POLICY_OUTDATED (+ current_version) ·
 *     422 CODE_REJECTED | METHOD_UNAVAILABLE | SHIPPING_LOCATION_INVALID · 413 · 415 · 429 RATE_LIMITED · 503 UNAVAILABLE
 *
 * El servidor todavía no devuelve un enlace de pasarela (el cobro es la siguiente tarea de izao-pagos): tras crear el
 * pedido se va siempre a `/{pais}/pedido/{public_token}`, que muestra el pago pendiente cuando exista su enlace.
 */
import { z } from 'zod';

export const RUTA_CHECKOUT = '/api/checkout';

export const SIGUIENTES_PASOS = ['pay_wompi', 'pay_addi', 'pay_sistecredito', 'pay_cod_deposit', 'manual_whatsapp'] as const;

export const RespuestaPedidoCreado = z.object({
  order: z.object({ number: z.string().regex(/^[A-Za-z0-9-]+$/) }),
  public_token: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
  next_step: z.enum(SIGUIENTES_PASOS),
  repeated: z.boolean().optional(),
});
export type RespuestaPedidoCreado = z.infer<typeof RespuestaPedidoCreado>;

export const ErrorCheckout = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  lines: z.array(z.object({ variant_id: z.string(), max_quantity: z.number().int().min(0) })).optional(),
  reason: z.string().nullish(),
  missing_amount: z.string().nullish(),
  /** `DATA_POLICY_OUTDATED`: versión vigente de la política de datos (`pages.version` en texto). */
  current_version: z.string().nullish(),
});
export type ErrorCheckout = z.infer<typeof ErrorCheckout>;

/** Cuerpo que se envía; la forma real la valida el servidor con `checkoutInputSchemaFor`. */
export interface CuerpoCheckout {
  country_code: 'CO' | 'EC';
  idempotency_key: string;
  items: { variant_id: string; quantity: number }[];
  contact: { first_name: string; last_name: string; phone: string; email: string | null };
  document: { type: string; number: string };
  shipping: {
    region_id: string;
    city_id: string;
    district: string | null;
    address1: string;
    address2: string | null;
    notes: string | null;
  };
  payment_method: 'wompi' | 'addi' | 'sistecredito' | 'cod' | 'manual';
  discount_code: string | null;
  consents: { terms_and_data: true; whatsapp: boolean };
  data_policy_version: string;
}
