import { depsAgenteDesdeEnv } from '../../../_lib/fuente-supabase';
import { manejarResultado } from '../../../_lib/manejar';

/** `POST /api/agent/jobs/{id}/result` (contrato v1, docs/integraciones/agente-api.md). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manejarResultado(req, id, depsAgenteDesdeEnv());
}
