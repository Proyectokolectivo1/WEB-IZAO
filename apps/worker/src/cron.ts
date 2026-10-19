import type { Queue } from 'bullmq';
import { JOB_PURGAR_AUDIT_LOG } from './jobs/purgar-audit-log.js';

/**
 * Tareas repetibles (cron). `upsertJobScheduler` es idempotente: reiniciar el
 * worker no duplica la programación. Zona horaria de negocio: America/Bogota.
 */
export async function registrarCron(colaSistema: Queue): Promise<void> {
  await colaSistema.upsertJobScheduler(
    'latido',
    { pattern: '*/5 * * * *', tz: 'America/Bogota' },
    { name: 'latido', data: {} },
  );
  // Purga diaria de eventos antiguos de sesión de admin (03:30 Bogotá).
  await colaSistema.upsertJobScheduler(
    JOB_PURGAR_AUDIT_LOG,
    { pattern: '30 3 * * *', tz: 'America/Bogota' },
    { name: JOB_PURGAR_AUDIT_LOG, data: {} },
  );
}
