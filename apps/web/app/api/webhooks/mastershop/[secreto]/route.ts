import { clienteDb } from '@/lib/db/cliente';
import { encolarSyncMasterShop } from '../cola';
import { manejarWebhookMasterShop } from '../manejar';

/**
 * `POST /api/webhooks/mastershop/{secreto}` (§14.5): notificaciones de pedidos de MasterShop. Lógica y contrato
 * en `../manejar.ts`. Node (no Edge): necesita `node:crypto` y BullMQ. Sin caché.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function registrar(eventId: string, payload: Record<string, unknown>): Promise<{ procesado: boolean }> {
  const db = clienteDb();
  const ins = await db
    .from('webhook_events')
    .upsert(
      { provider: 'mastershop', event_id: eventId, signature_valid: true, payload: payload as never },
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    );
  if (ins.error) throw new Error(`webhook_events: ${ins.error.code ?? 'error'}`);
  const { data, error } = await db
    .from('webhook_events')
    .select('processed_at')
    .eq('provider', 'mastershop')
    .eq('event_id', eventId)
    .single();
  if (error) throw new Error(`webhook_events: ${error.code ?? 'error'}`);
  return { procesado: data.processed_at !== null };
}

export async function POST(req: Request, ctx: { params: Promise<{ secreto: string }> }) {
  const { secreto } = await ctx.params;
  return manejarWebhookMasterShop(req, secreto, {
    secreto: process.env.MASTERSHOP_WEBHOOK_PATH_SECRET,
    registrar,
    encolar: encolarSyncMasterShop,
  });
}
