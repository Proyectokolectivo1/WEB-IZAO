/**
 * Webhook de MasterShop (§14.5 paso 4, regla 5). MasterShop no firma las notificaciones (colección de Postman,
 * "Verificación de origen": sin firma, HMAC ni secreto compartido), así que la verificación es el segmento
 * secreto de la ruta `/api/webhooks/mastershop/{MASTERSHOP_WEBHOOK_PATH_SECRET}`, comparado en tiempo constante.
 *
 * Orden: secreto → cuerpo crudo con tope → JSON → referencia del pedido → registro idempotente en
 * `webhook_events (provider 'mastershop', event_id)` → encolar `carrier.sync` → 200. Nada cambia el pedido
 * aquí: el job reconsulta `GET /api/orders`. Secreto inválido: 401 sin registrar. Base o Redis caídos: 503.
 * Las respuestas no incluyen detalles; los logs solo el motivo, nunca el cuerpo ni el secreto.
 */
import {
  idEventoNotificacion,
  parsearNotificacion,
  payloadRegistrable,
  verificarSecretoRuta,
  type DatosJobSync,
} from '@izao/mastershop';

export interface DepsWebhookMasterShop {
  secreto: string | undefined;
  /** Inserta si no existe; devuelve si ese evento ya se procesó. */
  registrar(eventId: string, payload: Record<string, unknown>): Promise<{ procesado: boolean }>;
  encolar(datos: DatosJobSync): Promise<void>;
}

/** El cuerpo trae el pedido completo; 256 KB sobra. */
const MAX_BYTES = 256 * 1024;

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function manejarWebhookMasterShop(
  req: Request,
  segmento: string,
  deps: DepsWebhookMasterShop,
): Promise<Response> {
  if (!verificarSecretoRuta(segmento, deps.secreto)) {
    console.warn('[webhook mastershop] secreto de ruta inválido');
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.byteLength > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(new TextDecoder().decode(crudo));
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }
  const n = parsearNotificacion(cuerpo);
  if (!n) return json({ ok: true, ignorado: true }, 200);

  try {
    const eventId = idEventoNotificacion(n);
    const r = await deps.registrar(eventId, payloadRegistrable(n));
    if (r.procesado) return json({ ok: true, repetido: true }, 200);
    await deps.encolar({
      event_id: eventId,
      provider_order_id: n.providerOrderId,
      external_order_id: n.externalOrderId,
      origen: 'webhook',
    });
    return json({ ok: true }, 200);
  } catch (err) {
    console.error(`[webhook mastershop] falla interna: ${err instanceof Error ? err.name : 'error'}`);
    return json({ error: 'UNAVAILABLE' }, 503);
  }
}
