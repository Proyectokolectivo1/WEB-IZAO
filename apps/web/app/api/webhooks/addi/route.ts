import type { VerifiedEvent } from '@izao/core/contracts';
import { clienteDb } from '@/lib/db/cliente';
import { credencialesAddiActivas } from '@/lib/checkout/fuente-pagos-supabase';
import { encolarJobAddi } from './cola';
import { manejarWebhookAddi } from './manejar';

/**
 * `POST /api/webhooks/addi` (§12.3, D-031): callback de la solicitud de crédito con autenticación HTTP Basic.
 * Es el `allyUrlRedirection.callbackUrl` que envía `construirSolicitudAddi`. Lógica y contrato en `./manejar.ts`.
 * Node (no Edge): necesita `node:crypto` y BullMQ. Sin caché.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function registrar(e: VerifiedEvent): Promise<{ procesado: boolean }> {
  const db = clienteDb();
  const ins = await db
    .from('webhook_events')
    .upsert(
      { provider: 'addi', event_id: e.event_id, signature_valid: true, payload: e.payload as never },
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    );
  if (ins.error) throw new Error(`webhook_events: ${ins.error.code ?? 'error'}`);
  const { data, error } = await db
    .from('webhook_events')
    .select('processed_at')
    .eq('provider', 'addi')
    .eq('event_id', e.event_id)
    .single();
  if (error) throw new Error(`webhook_events: ${error.code ?? 'error'}`);
  return { procesado: data.processed_at !== null };
}

export async function POST(req: Request) {
  return manejarWebhookAddi(req, {
    credenciales: async () => {
      const c = await credencialesAddiActivas();
      return c ? { usuario: c.usuarioCallback, clave: c.claveCallback } : null;
    },
    registrar,
    encolar: encolarJobAddi,
  });
}
