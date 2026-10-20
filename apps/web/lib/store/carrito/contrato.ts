/**
 * Contrato de la vista previa del carrito con el servidor (dueño: izao-pagos, Oleada 3).
 *
 * `POST /api/checkout/preview`
 *   cuerpo:    { country: 'co'|'ec', items: [{ variant_id, quantity }], code?: string }
 *   respuesta: { lines: [{ variant_id, quantity, unit_price, compare_at, max_quantity, line_discount }],
 *                subtotal, discount, code: { status, code, reason, missing_amount } | null }
 *   - Montos: enteros en unidad menor, en TEXTO.
 *   - `max_quantity` = min(existencias vendibles, cantidad pedida); 0 = agotado (no revela el inventario).
 *   - `reason`: códigos de `DiscountRejectionCode`; inexistente, inactivo y de otro país llegan colapsados en `CODE_INVALID`.
 *   - `applied` es provisional: los límites por cliente solo se verifican al crear el pedido.
 *
 * Implementado por izao-pagos (commit 3a7e66b). Si el servidor no responde, el bolso muestra el subtotal local (`calcularPrecios`).
 *   - Aditivo: `payment_method?` en la entrada y `totals` en la salida (checkout); `code.status = 'withdrawn'` con Addi/Sistecrédito.
 */
import { z } from 'zod';

const monto = z.string().regex(/^\d{1,15}$/);

export const RespuestaVistaPrevia = z.object({
  lines: z.array(
    z.object({
      variant_id: z.string(),
      quantity: z.number().int().min(0),
      unit_price: monto,
      compare_at: monto.nullable(),
      max_quantity: z.number().int().min(0),
      line_discount: monto,
    }),
  ),
  subtotal: monto,
  discount: monto,
  code: z
    .object({
      // `withdrawn`: solo si se pide con Addi o Sistecrédito (el código no aplica con financiación).
      status: z.enum(['applied', 'rejected', 'withdrawn']),
      code: z.string(),
      reason: z.string().nullable(),
      missing_amount: monto.nullable(),
    })
    .nullable(),
  // Aditivo (izao-pagos): con `payment_method` en la entrada, recargo, abono y recaudo del método.
  totals: z
    .object({
      payment_method: z.string().nullable(),
      payment_method_available: z.boolean(),
      surcharge: monto,
      total_customer: monto,
      cod_deposit: monto,
      cod_collect: monto,
      available_methods: z.array(z.object({ method: z.string(), available: z.boolean(), reason: z.string().nullable() })),
      manual_allowed: z.boolean(),
    })
    .optional(),
});
export const RUTA_VISTA_PREVIA = '/api/checkout/preview';
export type RespuestaVistaPrevia = z.infer<typeof RespuestaVistaPrevia>;

/** Mensajes del código de descuento, con la voz de §8.6. Los códigos vienen de `DiscountRejectionCode`. */
export function mensajeCodigo(reason: string | null): string {
  switch (reason) {
    case 'CODE_EXPIRED':
      return 'Ese código ya venció. Prueba con otro.';
    case 'CODE_NOT_STARTED':
      return 'Ese código todavía no está activo.';
    case 'CODE_LIMIT_REACHED':
      return 'Ese código ya se agotó.';
    case 'CODE_MIN_SUBTOTAL':
      return 'Aún no llegas al mínimo de compra para ese código.';
    case 'CODE_NOT_APPLICABLE':
      return 'Ese código no aplica a lo que hay en tu bolso.';
    case 'CODE_WRONG_COUNTRY':
    case 'CODE_INACTIVE':
    case 'CODE_INVALID':
    default:
      return 'No reconocemos ese código. Revisa que esté bien escrito.';
  }
}
