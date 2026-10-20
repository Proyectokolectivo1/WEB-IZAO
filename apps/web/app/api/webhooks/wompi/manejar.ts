/**
 * Webhook de Wompi (§12.2, regla 5). Orden: cuerpo crudo con tope → firma (checksum + ambiente) → registro
 * idempotente en `webhook_events (provider, event_id)` → encolar `wompi.transaccion` → 200.
 * Nada cambia el pedido aquí: el job reconsulta la transacción con la API y transiciona.
 * - Firma inválida: 401, sin registrar (si se guardara, un tercero podría ocupar el id del evento real).
 * - Sin credenciales o con la base/Redis caídos: 503, y Wompi reintenta (3 veces en 24 h).
 * Las respuestas no incluyen detalles; los logs solo el motivo, nunca el cuerpo ni secretos.
 */
import type { Environment, VerifiedEvent } from '@izao/core/contracts';
import { verificarEvento, type DatosJobWompi } from '@izao/wompi';

export interface DepsWebhookWompi {
  credenciales(): Promise<{ ambiente: Environment; secretoEventos: string } | null>;
  /** Inserta si no existe; devuelve si ese evento ya se procesó. */
  registrar(evento: VerifiedEvent): Promise<{ procesado: boolean }>;
  encolar(datos: DatosJobWompi): Promise<void>;
}

const MAX_BYTES = 64 * 1024;

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function manejarWebhookWompi(req: Request, deps: DepsWebhookWompi): Promise<Response> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.byteLength > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  const cabeceras: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    cabeceras[k.toLowerCase()] = v;
  });

  try {
    const creds = await deps.credenciales();
    if (!creds) {
      console.error('[webhook wompi] sin credenciales activas');
      return json({ error: 'UNAVAILABLE' }, 503);
    }
    const v = verificarEvento(crudo, cabeceras, { secretoEventos: creds.secretoEventos, ambiente: creds.ambiente });
    if (!v.ok) {
      console.warn(`[webhook wompi] rechazado: ${v.motivo}`);
      return json({ error: 'INVALID_SIGNATURE' }, 401);
    }
    const e = v.evento;
    if (e.event_type !== 'transaction.updated' || !e.refs.provider_transaction_id) return json({ ok: true }, 200);

    const r = await deps.registrar(e);
    if (r.procesado) return json({ ok: true, repetido: true }, 200);
    await deps.encolar({ event_id: e.event_id, transaction_id: e.refs.provider_transaction_id });
    return json({ ok: true }, 200);
  } catch (err) {
    console.error(`[webhook wompi] falla interna: ${err instanceof Error ? err.name : 'error'}`);
    return json({ error: 'UNAVAILABLE' }, 503);
  }
}
