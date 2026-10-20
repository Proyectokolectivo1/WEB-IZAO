/**
 * Webhook de la WhatsApp Cloud API (§13.2, regla 5, D-025). Orden en `POST`: cuerpo crudo con tope → firma
 * `X-Hub-Signature-256` (HMAC-SHA256 con el `app_secret`) → interpretar → registro idempotente en
 * `webhook_events (provider 'whatsapp', event_id)` por evento → encolar `whatsapp.evento` → 200.
 * Nada cambia mensajes ni plantillas aquí: lo hace el worker.
 * - Firma inválida: 401 sin registrar. Sin credenciales o base/Redis caídos: 503 (Meta reintenta hasta 7 días).
 * - Logs solo con el motivo; nunca el cuerpo (trae números de teléfono) ni secretos.
 */
import { interpretarWebhook, verificarDesafio, verificarFirmaMeta, type EventoWhatsApp } from '@izao/whatsapp';

export interface DepsWebhookWhatsApp {
  /** Secretos de las credenciales activas (una por país; puede ser la misma app). */
  credenciales(): Promise<{ appSecrets: string[]; tokensVerificacion: string[] } | null>;
  /** Inserta si no existe; devuelve si ese evento ya se procesó. */
  registrar(evento: EventoWhatsApp): Promise<{ procesado: boolean }>;
  encolar(eventId: string): Promise<void>;
}

const MAX_BYTES = 1024 * 1024;

function json(cuerpo: unknown, status: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function manejarDesafioWhatsApp(req: Request, deps: DepsWebhookWhatsApp): Promise<Response> {
  try {
    const creds = await deps.credenciales();
    const q = new URL(req.url).searchParams;
    const challenge = creds?.tokensVerificacion.map((t) => verificarDesafio(q, t)).find((c) => c !== null) ?? null;
    if (challenge === null) return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (err) {
    console.error(`[webhook whatsapp] desafío: ${err instanceof Error ? err.name : 'error'}`);
    return new Response('Unavailable', { status: 503 });
  }
}

export async function manejarWebhookWhatsApp(req: Request, deps: DepsWebhookWhatsApp): Promise<Response> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (crudo.byteLength > MAX_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  try {
    const creds = await deps.credenciales();
    if (!creds || creds.appSecrets.length === 0) {
      console.error('[webhook whatsapp] sin credenciales activas');
      return json({ error: 'UNAVAILABLE' }, 503);
    }
    const firma = req.headers.get('x-hub-signature-256');
    if (!creds.appSecrets.some((s) => verificarFirmaMeta(crudo, firma, s))) {
      console.warn('[webhook whatsapp] firma inválida');
      return json({ error: 'INVALID_SIGNATURE' }, 401);
    }
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(new TextDecoder().decode(crudo));
    } catch {
      return json({ error: 'INVALID_JSON' }, 400);
    }
    for (const e of interpretarWebhook(cuerpo)) {
      const r = await deps.registrar(e);
      if (!r.procesado) await deps.encolar(e.event_id);
    }
    return json({ ok: true }, 200);
  } catch (err) {
    console.error(`[webhook whatsapp] falla interna: ${err instanceof Error ? err.name : 'error'}`);
    return json({ error: 'UNAVAILABLE' }, 503);
  }
}
