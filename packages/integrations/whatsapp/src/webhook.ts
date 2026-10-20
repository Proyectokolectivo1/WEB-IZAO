/**
 * Webhook de la WhatsApp Cloud API (§13.2, D-025).
 * - `GET`: `hub.mode=subscribe` + `hub.verify_token` igual al del panel → 200 con `hub.challenge`.
 * - `POST`: `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 del cuerpo CRUDO con el `app_secret`.
 * Meta reintenta hasta 7 días y repite entregas: cada evento lleva un `event_id` estable para `webhook_events`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function firmaMeta(crudo: Uint8Array, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(crudo).digest('hex')}`;
}

export function verificarFirmaMeta(crudo: Uint8Array, cabecera: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !cabecera) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(cabecera.trim());
  if (!m) return false;
  const esperado = Buffer.from(firmaMeta(crudo, appSecret).slice(7), 'hex');
  const recibido = Buffer.from(m[1]!.toLowerCase(), 'hex');
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

function igualesConstante(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Challenge a devolver, o `null` (responder 403). */
export function verificarDesafio(q: URLSearchParams, tokenVerificacion: string): string | null {
  if (!tokenVerificacion) return null;
  const token = q.get('hub.verify_token') ?? '';
  const challenge = q.get('hub.challenge') ?? '';
  if (q.get('hub.mode') !== 'subscribe' || !igualesConstante(token, tokenVerificacion)) return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(challenge) ? challenge : null;
}

export type EstadoMensajeWa = 'sent' | 'delivered' | 'read' | 'failed';

export type EventoWhatsApp =
  | {
      tipo: 'estado_mensaje';
      event_id: string;
      wa_message_id: string;
      status: EstadoMensajeWa;
      timestamp: number;
      error: { code: string; text: string } | null;
    }
  | {
      tipo: 'estado_plantilla';
      event_id: string;
      meta_template_id: string;
      meta_template_name: string;
      language: string;
      event: string;
      reason: string | null;
    };

const estadoSchema = z.object({
  id: z.string().min(1).max(256),
  status: z.string(),
  timestamp: z.string().regex(/^\d{1,12}$/),
  errors: z
    .array(z.object({ code: z.number().int(), title: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

const plantillaSchema = z.object({
  event: z.string().regex(/^[A-Z_]{1,40}$/),
  message_template_id: z.union([z.number().int(), z.string().regex(/^\d{1,30}$/)]),
  message_template_name: z.string().min(1).max(512),
  message_template_language: z.string().min(1).max(20),
  reason: z.string().nullish(),
  rejection_info: z.object({ reason: z.string().optional() }).nullish(),
});

const ESTADOS_UTILES = new Set<string>(['sent', 'delivered', 'read', 'failed']);

/** Eventos que interesan a Izao. Nunca lanza: lo que no se reconoce se ignora (Meta espera 200 igual). */
export function interpretarWebhook(cuerpo: unknown): EventoWhatsApp[] {
  const out: EventoWhatsApp[] = [];
  if (!cuerpo || typeof cuerpo !== 'object') return out;
  const c = cuerpo as { object?: unknown; entry?: unknown };
  if (c.object !== 'whatsapp_business_account' || !Array.isArray(c.entry)) return out;
  for (const entry of c.entry as Array<{ time?: unknown; changes?: unknown }>) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const ch of entry.changes as Array<{ field?: unknown; value?: unknown }>) {
      if (ch?.field === 'messages') {
        const statuses = (ch.value as { statuses?: unknown } | undefined)?.statuses;
        if (!Array.isArray(statuses)) continue;
        for (const s of statuses) {
          const p = estadoSchema.safeParse(s);
          if (!p.success || !ESTADOS_UTILES.has(p.data.status)) continue;
          const e = p.data.errors?.[0];
          out.push({
            tipo: 'estado_mensaje',
            event_id: `${p.data.id}.${p.data.status}`,
            wa_message_id: p.data.id,
            status: p.data.status as EstadoMensajeWa,
            timestamp: Number(p.data.timestamp),
            error: e ? { code: String(e.code), text: (e.title ?? e.message ?? '').slice(0, 300) } : null,
          });
        }
      } else if (ch?.field === 'message_template_status_update') {
        const p = plantillaSchema.safeParse(ch.value);
        if (!p.success) continue;
        const v = p.data;
        const time = typeof entry.time === 'number' && Number.isInteger(entry.time) ? entry.time : 0;
        const motivo = [v.reason && v.reason !== 'NONE' ? v.reason : null, v.rejection_info?.reason ?? null].filter(Boolean).join(': ');
        out.push({
          tipo: 'estado_plantilla',
          event_id: `tpl.${v.message_template_id}.${v.event}.${time}`,
          meta_template_id: String(v.message_template_id),
          meta_template_name: v.message_template_name,
          language: v.message_template_language,
          event: v.event,
          reason: motivo ? motivo.slice(0, 500) : null,
        });
      }
    }
  }
  return out;
}
