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
// Validador propio y mínimo (no `zod`): estos esquemas viajan en el JS del bolso y del checkout (ver `lib/store/esquema-ligero.ts`).
import { anulable, booleano, enteroNoNegativo, enumerado, lista, objeto, opcional, texto, type Inferir } from '../esquema-ligero';

const monto = texto(/^\d{1,15}$/);

export const RespuestaVistaPrevia = objeto({
  lines: lista(
    objeto({
      variant_id: texto(),
      quantity: enteroNoNegativo(),
      unit_price: monto,
      compare_at: anulable(monto),
      max_quantity: enteroNoNegativo(),
      line_discount: monto,
    }),
  ),
  subtotal: monto,
  discount: monto,
  code: anulable(
    objeto({
      // `withdrawn`: solo si se pide con Addi o Sistecrédito (el código no aplica con financiación).
      status: enumerado(['applied', 'rejected', 'withdrawn']),
      code: texto(),
      reason: anulable(texto()),
      missing_amount: anulable(monto),
    }),
  ),
  // Aditivo (izao-pagos): con `payment_method` en la entrada, recargo, abono y recaudo del método.
  totals: opcional(
    objeto({
      payment_method: anulable(texto()),
      payment_method_available: booleano(),
      surcharge: monto,
      total_customer: monto,
      cod_deposit: monto,
      cod_collect: monto,
      available_methods: lista(objeto({ method: texto(), available: booleano(), reason: anulable(texto()) })),
      manual_allowed: booleano(),
    }),
  ),
});
export const RUTA_VISTA_PREVIA = '/api/checkout/preview';
export type RespuestaVistaPrevia = Inferir<typeof RespuestaVistaPrevia>;

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
