import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import { leerCredencialesWhatsApp, type EventoWhatsApp } from '@izao/whatsapp';
import { clienteDb } from '@/lib/db/cliente';
import { encolarEventoWhatsApp } from './cola';
import { manejarDesafioWhatsApp, manejarWebhookWhatsApp, type DepsWebhookWhatsApp } from './manejar';

/**
 * `GET|POST /api/webhooks/whatsapp` (§13.2): verificación de Meta y estados de mensajes y plantillas.
 * Lógica y contrato en `./manejar.ts`. Node (no Edge): `node:crypto` y BullMQ. Sin caché.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function credenciales(): Promise<{ appSecrets: string[]; tokensVerificacion: string[] } | null> {
  const clave = process.env.APP_ENCRYPTION_KEY;
  if (!clave) return null;
  const { data, error } = await clienteDb()
    .from('integration_credentials')
    .select('country_code,environment,data_encrypted,iv,key_version')
    .eq('provider', 'whatsapp')
    .eq('is_active', true);
  if (error) throw new Error(`integration_credentials: ${error.code ?? 'error'}`);
  const appSecrets: string[] = [];
  const tokensVerificacion: string[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    try {
      const valores = await descifrarCredenciales(
        clave,
        {
          provider: 'whatsapp',
          country_code: String(r.country_code),
          environment: r.environment === 'sandbox' ? 'sandbox' : 'production',
        },
        {
          data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)),
          iv: byteaDesdePostgrest(String(r.iv)),
          key_version: Number(r.key_version),
        },
      );
      const c = leerCredencialesWhatsApp(valores);
      if (c) {
        appSecrets.push(c.appSecret);
        tokensVerificacion.push(c.tokenVerificacion);
      }
    } catch (e) {
      console.error(`[webhook whatsapp] credencial ilegible: ${e instanceof Error ? e.name : 'error'}`);
    }
  }
  return appSecrets.length ? { appSecrets, tokensVerificacion } : null;
}

async function registrar(e: EventoWhatsApp): Promise<{ procesado: boolean }> {
  const db = clienteDb();
  const ins = await db
    .from('webhook_events')
    .upsert(
      { provider: 'whatsapp', event_id: e.event_id, signature_valid: true, payload: e as never },
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    );
  if (ins.error) throw new Error(`webhook_events: ${ins.error.code ?? 'error'}`);
  const { data, error } = await db
    .from('webhook_events')
    .select('processed_at')
    .eq('provider', 'whatsapp')
    .eq('event_id', e.event_id)
    .single();
  if (error) throw new Error(`webhook_events: ${error.code ?? 'error'}`);
  return { procesado: data.processed_at !== null };
}

const deps: DepsWebhookWhatsApp = { credenciales, registrar, encolar: encolarEventoWhatsApp };

export async function GET(req: Request) {
  return manejarDesafioWhatsApp(req, deps);
}

export async function POST(req: Request) {
  return manejarWebhookWhatsApp(req, deps);
}
