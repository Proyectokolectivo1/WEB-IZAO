import { depsAgenteDesdeEnv } from '../../_lib/fuente-supabase';
import { manejarReclamo } from '../../_lib/manejar';

/** `POST /api/agent/jobs/claim` (contrato v1, docs/integraciones/agente-api.md). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return manejarReclamo(req, depsAgenteDesdeEnv());
}
