import type { Queue } from 'bullmq';
import { CRON_BARRIDO_PEDIDOS, JOB_BARRIDO_PEDIDOS } from './jobs/cod/barrido.js';
import { CRON_BILLETERA_MASTERSHOP, CRON_POLLING_MASTERSHOP, JOB_BILLETERA_MASTERSHOP, JOB_POLLING_MASTERSHOP } from './jobs/sync/index.js';
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
  // Barrido de pedidos vencidos, reservas huérfanas y contra entrega sin link (idempotente).
  await colaSistema.upsertJobScheduler(
    JOB_BARRIDO_PEDIDOS,
    { pattern: CRON_BARRIDO_PEDIDOS, tz: 'America/Bogota' },
    { name: JOB_BARRIDO_PEDIDOS, data: {} },
  );
  // Respaldo de webhooks de MasterShop: polling cada 10 min y conciliación de billetera cada hora (minuto 7).
  await colaSistema.upsertJobScheduler(
    JOB_POLLING_MASTERSHOP,
    { pattern: CRON_POLLING_MASTERSHOP, tz: 'America/Bogota' },
    { name: JOB_POLLING_MASTERSHOP, data: {} },
  );
  await colaSistema.upsertJobScheduler(
    JOB_BILLETERA_MASTERSHOP,
    { pattern: CRON_BILLETERA_MASTERSHOP, tz: 'America/Bogota' },
    { name: JOB_BILLETERA_MASTERSHOP, data: {} },
  );
}
