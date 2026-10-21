import { depsAgenteDesdeEnv } from '../_lib/fuente-supabase';
import { manejarConfig } from '../_lib/manejar';

/** `GET /api/agent/config` (contrato v1, docs/integraciones/agente-api.md). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return manejarConfig(req, depsAgenteDesdeEnv());
}
