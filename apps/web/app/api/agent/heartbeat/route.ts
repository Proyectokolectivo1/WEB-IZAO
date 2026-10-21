import { depsAgenteDesdeEnv } from '../_lib/fuente-supabase';
import { manejarLatido } from '../_lib/manejar';

/** `POST /api/agent/heartbeat` (contrato v1, docs/integraciones/agente-api.md). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return manejarLatido(req, depsAgenteDesdeEnv());
}
