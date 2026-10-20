/**
 * Envoltorio de `crear_pedido_checkout(p jsonb)` (`20261020140537_crear_pedido_checkout.sql`).
 *
 * SOLO SERVIDOR. Una sola transacción en la base: pedido → líneas → `reservar_stock` → `reservar_canje` → evento
 * `created`. Todo o nada: un rechazo no deja pedido, reserva ni canje. Idempotente por `checkout_idempotency_key`.
 * El estado inicial lo fija la base según el método (wompi/addi/sistecredito → pendiente_pago, cod → esperando_abono,
 * manual → pendiente_manual). Dinero en enteros de unidad menor (number o string); la respuesta lo devuelve en texto.
 * Contrato completo en `docs/estado/izao-db.md`.
 */
import 'server-only';
import { z } from 'zod';
import { ORDER_STATUSES } from '@izao/core/order-state';
import { llamarRpc } from './cliente';

const uuid = z.guid();
/** Entero no negativo en unidad menor (texto para no perder precisión con bigint). */
const monto = z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/)]);
const montoTexto = z.string().regex(/^\d{1,18}$/);
const texto = z.string().nullable().optional();

export const pedidoCheckoutSchema = z.object({
  country_code: z.enum(['CO', 'EC']),
  currency_code: z.enum(['COP', 'USD']),
  contact_first_name: z.string().min(1),
  contact_last_name: z.string().min(1),
  contact_phone_e164: z.string().min(1),
  contact_email: texto,
  document_type: texto,
  document_number: texto,
  shipping_region_id: uuid.nullable().optional(),
  shipping_city_id: uuid.nullable().optional(),
  shipping_region_name: texto,
  shipping_city_name: texto,
  shipping_district: texto,
  shipping_address1: texto,
  shipping_address2: texto,
  shipping_zip: texto,
  shipping_notes: texto,
  payment_method: z.enum(['wompi', 'addi', 'sistecredito', 'cod', 'manual']),
  subtotal: monto,
  discount_code_id: uuid.nullable().optional(),
  discount_amount: monto.optional(),
  /** `numeric(5,2)` en texto, p. ej. "12.50". */
  financing_surcharge_pct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  financing_surcharge_amount: monto.optional(),
  total_customer: monto,
  cod_deposit_amount: monto.optional(),
  cod_collect_amount: monto.optional(),
  product_cost_total: monto.optional(),
  gateway_fee_estimated: monto.optional(),
  customer_id: uuid.nullable().optional(),
  influencer_id: uuid.nullable().optional(),
  utm: z.record(z.string(), z.unknown()).optional(),
  click_ids: z.record(z.string(), z.unknown()).optional(),
  checkout_idempotency_key: z.string().min(1).max(200),
  terms_accepted_at: z.string().nullable().optional(),
  data_policy_version: texto,
  whatsapp_opt_in: z.boolean().optional(),
});

export const lineaCheckoutSchema = z.object({
  product_id: uuid.nullable(),
  variant_id: uuid.nullable(),
  sku: z.string().min(1),
  name_snapshot: z.string().min(1),
  variant_label: z.string().nullable(),
  quantity: z.number().int().positive(),
  unit_price: monto,
  unit_compare_at: monto.nullable().optional(),
  unit_cost: monto.nullable().optional(),
  line_discount: monto.optional(),
  /** `numeric` en texto o número. */
  weight_kg: z.union([z.number(), z.string()]).nullable().optional(),
  mastershop_product_id: z.number().int().nullable().optional(),
  mastershop_variant_id: z.number().int().nullable().optional(),
});

export const entradaCrearPedidoSchema = z.object({
  order: pedidoCheckoutSchema,
  items: z.array(lineaCheckoutSchema).min(1),
});
export type EntradaCrearPedido = z.input<typeof entradaCrearPedidoSchema>;

const resumenSchema = z.object({
  id: uuid,
  number: z.string(),
  public_token: z.string(),
  /** Estado actual: en un repetido puede haber avanzado (p. ej. pagado). */
  status: z.enum(ORDER_STATUSES),
  country_code: z.enum(['CO', 'EC']),
  currency_code: z.enum(['COP', 'USD']),
  payment_method: z.enum(['wompi', 'addi', 'sistecredito', 'cod', 'manual']),
  subtotal: montoTexto,
  discount_amount: montoTexto,
  financing_surcharge_amount: montoTexto,
  total_customer: montoTexto,
  cod_deposit_amount: montoTexto,
  cod_collect_amount: montoTexto,
  lines: z.array(
    z.object({
      variant_id: uuid.nullable(),
      name_snapshot: z.string(),
      variant_label: z.string().nullable(),
      quantity: z.number().int(),
      unit_price: montoTexto,
      line_discount: montoTexto,
    }),
  ),
});
export type ResumenPedidoCheckout = z.infer<typeof resumenSchema>;

export const motivosCrearPedido = [
  'idempotencia_conflicto',
  'en_proceso',
  'sin_stock',
  'sin_items',
  'codigo_inactivo',
  'codigo_de_otro_pais',
  'codigo_fuera_de_vigencia',
  'limite_total',
  'limite_por_cliente',
  'totales_inconsistentes',
  'datos_invalidos',
] as const;
export type MotivoCrearPedido = (typeof motivosCrearPedido)[number];

const faltanteSchema = z.object({
  variant_id: uuid.nullable(),
  sku: z.string().nullable(),
  solicitado: z.number().int(),
  disponible: z.number().int(),
  motivo: z.string(),
});

const resultadoSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    estado: z.enum(['creado', 'existente']),
    repetido: z.boolean(),
    order: resumenSchema,
  }),
  z.object({
    ok: z.literal(false),
    estado: z.enum(['rechazado', 'existente']),
    /** Motivos fuera de la lista (p. ej. `pedido_inexistente` de `reservar_stock`) también llegan aquí. */
    motivo: z.string(),
    detalle: z.string().optional(),
    faltantes: z.array(faltanteSchema).optional(),
  }),
]);
export type ResultadoCrearPedido = z.infer<typeof resultadoSchema>;

/**
 * Crea el pedido del checkout. Valida la entrada antes de llamar (lanza `ZodError` si es inválida) y la respuesta
 * después (lanza `ErrorDb` si la base cambia de forma). Un error de la base también lanza `ErrorDb`: en ese caso
 * la transacción se deshizo completa y no hay nada que deshacer.
 */
export async function crearPedidoCheckoutDb(entrada: EntradaCrearPedido): Promise<ResultadoCrearPedido> {
  const p = entradaCrearPedidoSchema.parse(entrada);
  return llamarRpc('crear_pedido_checkout', { p }, resultadoSchema);
}
