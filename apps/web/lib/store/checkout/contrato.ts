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
// Validador propio y mínimo (no `zod`): estos esquemas viajan en el JS del checkout (ver `lib/store/esquema-ligero.ts`).
import { enteroNoNegativo, enumerado, lista, nuloOIndefinido, objeto, opcional, booleano, texto, type Inferir } from '../esquema-ligero';

export const RUTA_CHECKOUT = '/api/checkout';

export const SIGUIENTES_PASOS = ['pay_wompi', 'pay_addi', 'pay_sistecredito', 'pay_cod_deposit', 'manual_whatsapp'] as const;

export const RespuestaPedidoCreado = objeto({
  order: objeto({ number: texto(/^[A-Za-z0-9-]+$/) }),
  public_token: texto(/^[A-Za-z0-9]{8,64}$/),
  next_step: enumerado(SIGUIENTES_PASOS),
  repeated: opcional(booleano()),
});
export type RespuestaPedidoCreado = Inferir<typeof RespuestaPedidoCreado>;

export const ErrorCheckout = objeto({
  error: texto(),
  issues: opcional(lista(objeto({ path: texto(), message: texto() }))),
  lines: opcional(lista(objeto({ variant_id: texto(), max_quantity: enteroNoNegativo() }))),
  reason: nuloOIndefinido(texto()),
  missing_amount: nuloOIndefinido(texto()),
  /** `DATA_POLICY_OUTDATED`: versión vigente de la política de datos (`pages.version` en texto). */
  current_version: nuloOIndefinido(texto()),
});
export type ErrorCheckout = Inferir<typeof ErrorCheckout>;

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
