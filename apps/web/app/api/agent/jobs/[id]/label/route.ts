import { depsAgenteDesdeEnv } from '../../../_lib/fuente-supabase';
import { manejarEtiqueta } from '../../../_lib/manejar';

/** `GET /api/agent/jobs/{id}/label` (contrato v1, docs/integraciones/agente-api.md). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manejarEtiqueta(req, id, depsAgenteDesdeEnv());
}
