/**
 * Contrato con el servidor del checkout (dueño: izao-pagos). Dado el encabezado `Cookie` de `POST /api/checkout` y,
 * si hay, el código de descuento que el servidor ya validó, devuelve lo que va a `orders.influencer_id`,
 * `orders.utm` y `orders.click_ids` (de ahí sale la columna generada `orders.sale_source`, ver
 * `fuenteDeVenta` en `lib/admin/metricas/dashboard.ts`).
 *
 * Reglas (el navegador solo da pistas; el servidor decide):
 *  1. Influencer: el del código aplicado al pedido (`discount_codes.influencer_id`); si no hay, el del código de la
 *     cookie `izao_ref` buscado en `discount_codes` (activo y del país del pedido). Un `ref` que no exista no falla
 *     el pedido: `influencer_id = null`.
 *  2. `utm` usa las claves `utm_source|utm_medium|utm_campaign|utm_term|utm_content`; `click_ids`, `fbclid|gclid|ttclid`.
 *     Valores ya acotados y sin marcado. Objetos vacíos si no hay datos (la columna es `not null default '{}'`).
 *  3. La atribución no entra en la huella de idempotencia: cambia con las cookies, no con la solicitud.
 */
import { leerAtribucion } from './captura';

export interface AtribucionPedido {
  influencer_id: string | null;
  utm: Record<string, string>;
  click_ids: Record<string, string>;
}

export interface DepsAtribucion {
  /** Cabecera `Cookie` de la petición. */
  cookie: string | null | undefined;
  /** `influencer_id` del código de descuento ya validado para este pedido, si lo hay. */
  influencerDelCodigoAplicado?: string | null;
  /** Influencer activo de un código por texto en mayúsculas, o `null` (código inexistente, inactivo o de otro país). */
  influencerDeCodigo: (codigo: string) => Promise<string | null>;
}

export async function atribucionDelPedido(deps: DepsAtribucion): Promise<AtribucionPedido> {
  const a = leerAtribucion(deps.cookie);
  let influencer = deps.influencerDelCodigoAplicado ?? null;
  if (!influencer && a.ref) {
    try {
      influencer = await deps.influencerDeCodigo(a.ref);
    } catch {
      influencer = null; // la atribución nunca bloquea la venta
    }
  }
  return { influencer_id: influencer, utm: a.utm, click_ids: a.click_ids };
}
