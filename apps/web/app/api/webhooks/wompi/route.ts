import type { VerifiedEvent } from '@izao/core/contracts';
import { clienteDb } from '@/lib/db/cliente';
import { credencialesWompiActivas } from '@/lib/checkout/fuente-pagos-supabase';
import { encolarJobWompi } from './cola';
import { manejarWebhookWompi } from './manejar';

/**
 * `POST /api/webhooks/wompi` (§12.2): evento `transaction.updated`. Lógica y contrato en `./manejar.ts`.
 * Node (no Edge): necesita `node:crypto` y BullMQ. Sin caché.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function registrar(e: VerifiedEvent): Promise<{ procesado: boolean }> {
  const db = clienteDb();
  const ins = await db
    .from('webhook_events')
    .upsert(
      { provider: 'wompi', event_id: e.event_id, signature_valid: true, payload: e.payload as never },
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    );
  if (ins.error) throw new Error(`webhook_events: ${ins.error.code ?? 'error'}`);
  const { data, error } = await db
    .from('webhook_events')
    .select('processed_at')
    .eq('provider', 'wompi')
    .eq('event_id', e.event_id)
    .single();
  if (error) throw new Error(`webhook_events: ${error.code ?? 'error'}`);
  return { procesado: data.processed_at !== null };
}

export async function POST(req: Request) {
  return manejarWebhookWompi(req, {
    credenciales: async () => {
      const c = await credencialesWompiActivas();
      return c ? { ambiente: c.ambiente, secretoEventos: c.secretoEventos } : null;
    },
    registrar,
    encolar: encolarJobWompi,
  });
}
