/**
 * Adaptador de la vista previa del servidor. Hoy no hay endpoint (lo construye izao-pagos en la Oleada 3),
 * así que devuelve `null` y el bolso trabaja con el subtotal local. Para activarlo basta con poner
 * `SERVIDOR_DISPONIBLE = true`; el servidor sigue recalculando todo al crear el pedido.
 */
import { RUTA_VISTA_PREVIA, RespuestaVistaPrevia } from './contrato';
import type { LineaCarrito } from './logica';

export const SERVIDOR_DISPONIBLE = false;

export async function pedirVistaPrevia(
  pais: string,
  lineas: readonly LineaCarrito[],
  codigo: string | null,
  senal?: AbortSignal,
): Promise<RespuestaVistaPrevia | null> {
  if (!SERVIDOR_DISPONIBLE) return null;
  const res = await fetch(RUTA_VISTA_PREVIA, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      country: pais,
      items: lineas.map((l) => ({ variant_id: l.variantId, quantity: l.cantidad })),
      ...(codigo ? { code: codigo } : {}),
    }),
    signal: senal,
  });
  if (!res.ok) return null;
  const parsed = RespuestaVistaPrevia.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}
