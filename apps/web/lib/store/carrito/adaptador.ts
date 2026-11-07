/**
 * Adaptador de la vista previa del servidor (`POST /api/checkout/preview`, izao-pagos, commit 3a7e66b).
 * Activo desde que la ruta está commiteada; si falla o no responde devuelve `null` y el bolso trabaja con el
 * subtotal local. El servidor sigue recalculando todo al crear el pedido.
 */
import { ErrorHttp, pedirJson } from '../fetcher';
import { RUTA_VISTA_PREVIA, RespuestaVistaPrevia } from './contrato';
import type { LineaCarrito } from './logica';

export const SERVIDOR_DISPONIBLE = true;

export async function pedirVistaPrevia(
  pais: string,
  lineas: readonly LineaCarrito[],
  codigo: string | null,
  senal?: AbortSignal,
  metodo?: string | null,
): Promise<RespuestaVistaPrevia | null> {
  if (!SERVIDOR_DISPONIBLE) return null;
  // Sin vigencia: el precio no se recuerda; solo se comparte la petición idéntica que ya está en vuelo (misma clave = método + cuerpo).
  let json: unknown;
  try {
    json = await pedirJson<unknown>(RUTA_VISTA_PREVIA, {
      signal: senal,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          country: pais,
          items: lineas.map((l) => ({ variant_id: l.variantId, quantity: l.cantidad })),
          ...(codigo ? { code: codigo } : {}),
          ...(metodo ? { payment_method: metodo } : {}),
        }),
      },
    });
  } catch (e) {
    if (e instanceof ErrorHttp) return null;
    throw e;
  }
  const parsed = RespuestaVistaPrevia.safeParse(json);
  return parsed.success ? parsed.data : null;
}
