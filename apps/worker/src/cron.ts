import type { Queue } from 'bullmq';

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
}
