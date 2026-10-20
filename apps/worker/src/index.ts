import { writeFileSync } from 'node:fs';
import type { Worker } from 'bullmq';
import { cancelarJobsCod, crearProcesadorCod, programadorCod } from './jobs/cod/index.js';
import { crearProcesadorPagos, dependenciasPagosDesdeEnv } from './jobs/payments/index.js';
import { registrarCron } from './cron.js';
import { createConnection, createQueue, createWorker, procesarSistema, QUEUE_NAMES } from './queues.js';

async function main(): Promise<void> {
  const connection = createConnection();
  const cola = createQueue(QUEUE_NAMES.sistema, connection);
  const worker = createWorker(QUEUE_NAMES.sistema, procesarSistema, connection);

  const colaCod = createQueue(QUEUE_NAMES.contraentrega, connection);
  const workerPagos = createWorker(
    QUEUE_NAMES.pagos,
    crearProcesadorPagos(
      dependenciasPagosDesdeEnv(
        // TODO(izao-logistica): reemplazar por la cola de la transportadora cuando exista su contrato.
        async (orderId) => {
          console.warn(`[worker] encolarTransportadora pendiente de izao-logistica (pedido ${orderId})`);
        },
        (orderId) => cancelarJobsCod(colaCod, orderId),
      ),
    ),
    connection,
  );

  // Registro condicionado: las dependencias de COD y el job `whatsapp.evento` los termina izao-pagos.
  // Hasta que existan sus exportaciones, la cola se crea (los productores ya encolan) pero sin consumidor.
  const trabajadores: Worker[] = [worker, workerPagos];
  const modCod = (await import('./jobs/cod/index.js')) as Record<string, unknown>;
  if (typeof modCod.dependenciasCodDesdeEnv === 'function') {
    const deps = (modCod.dependenciasCodDesdeEnv as (programar: ReturnType<typeof programadorCod>) => Parameters<typeof crearProcesadorCod>[0])(
      programadorCod(colaCod),
    );
    trabajadores.push(createWorker(QUEUE_NAMES.contraentrega, crearProcesadorCod(deps), connection));
  } else {
    console.warn('[worker] contraentrega sin consumidor: falta dependenciasCodDesdeEnv (izao-pagos)');
  }
  const colaWhatsapp = createQueue(QUEUE_NAMES.whatsapp, connection);
  // TODO(izao-pagos): al existir jobs/whatsapp/evento.ts, crear aquí createWorker(QUEUE_NAMES.whatsapp, …).
  console.warn('[worker] whatsapp sin consumidor: falta jobs/whatsapp (izao-pagos)');

  for (const w of trabajadores) {
    w.on('failed', (job, err) => {
      console.error(`[worker] ${w.name} job ${job?.id ?? '?'} falló: ${err.message}`);
    });
  }

  await connection.ping();
  await registrarCron(cola);
  console.log('[worker] conectado a Redis y escuchando colas');

  // Latido para el healthcheck de Docker: archivo que se renueva mientras Redis responde.
  const ARCHIVO_LATIDO = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker-alive';
  const latir = (): void => {
    connection
      .ping()
      .then(() => writeFileSync(ARCHIVO_LATIDO, String(Date.now())))
      .catch((err: Error) => console.error(`[worker] latido falló: ${err.message}`));
  };
  latir();
  const intervaloLatido = setInterval(latir, 15_000);

  let cerrando = false;
  const cerrar = async (senal: string): Promise<void> => {
    if (cerrando) return;
    cerrando = true;
    clearInterval(intervaloLatido);
    console.log(`[worker] ${senal} recibido, cerrando`);
    try {
      await Promise.all(trabajadores.map((w) => w.close()));
      await colaCod.close();
      await colaWhatsapp.close();
      await cola.close();
      await connection.quit();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void cerrar('SIGTERM'));
  process.on('SIGINT', () => void cerrar('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] error fatal:', err);
  process.exit(1);
});
