# Bitácora de izao-logistica

## Hecho
- Paquete `@izao/mastershop` sin red (antes de esta tarea): líneas, pedido, estados, cliente, adaptador, mock con trampas.
- `1dc959b` contrato de la cola `carrier` (`src/jobs.ts`: `COLA_CARRIER='carrier'`, nombres, ids, `encolarJobCarrier`), lectura del webhook (`src/webhook.ts`), mock con etiqueta automática y PDF servido. Export `./test-utils`.
- `20acdf2` worker `apps/worker/src/jobs/carrier/`: `carrier.create` (crear, guardar `shipments`, `enviado_transportadora`, confirmar, reintentos 30 s/2 min/10 min/30 min/2 h propios, `error_transportadora` + alerta), `carrier.poll_label` (cada 2 min, PDF a `MEDIA_ROOT/labels/`, `print_job`), `carrier.sync` (reconsulta y `planInternalTransition`), fuente PostgREST, modo `MASTERSHOP_MODO=simulado`. 27 pruebas contra el mock.
- `607beec` web `POST /api/webhooks/mastershop/[secreto]` (secreto en tiempo constante, `webhook_events` idempotente sin datos del cliente, encola `carrier.sync`). 5 pruebas.
- D-026 en `docs/DECISIONES.md`.

## Para izao-infra (registro de la cola; no edito index.ts/queues.ts)
- `queues.ts`: `QUEUE_NAMES.carrier = COLA_CARRIER` (import de `@izao/mastershop`).
- `index.ts`: `const colaCarrier = createQueue(QUEUE_NAMES.carrier, connection)`; reemplazar el stub por `encolarTransportadora(colaCarrier)` (de `./jobs/carrier/index.js`); `createWorker(QUEUE_NAMES.carrier, crearProcesadorCarrier(dependenciasCarrierDesdeEnv(programadorCarrier(colaCarrier))), connection)`; cerrar `colaCarrier`.
- Variables: `MEDIA_ROOT` (ya en compose), `MASTERSHOP_WEBHOOK_PATH_SECRET` en la web (≥ 32 caracteres; agregar a `.env.example`), `MASTERSHOP_MODO=simulado` opcional solo fuera de producción. El worker necesita escribir en `/srv/izao/media/labels`.

## Pendiente
- Polling de respaldo cada 10 min (`jobs/sync/`, `POST /api/orders/list` 45 días) → encolar `carrier.sync` con `origen: 'polling'`; necesita cron de izao-infra.
- Job horario de billetera (costos reales, `expenses`).
- Registro de webhooks desde el panel (`POST /api/webhooks`, `idWebhook` 16 y 17, guardar `idProductWebhook`) y botón "Reintentar" (usar `encolarJobCarrier` + `jobIdCrear` en la web) — con izao-admin.
- API del agente `/api/agent/*` y `docs/integraciones/agente-api.md` (avisar a izao-agente-windows).
- Pedido real de prueba en producción: solo con aprobación explícita del dueño.

## Siguiente paso exacto
Polling `jobs/sync/` con su prueba contra la ventana de 7 días y el límite 50 del mock.

## Decisiones que necesitan al líder
- izao-db: índice único parcial en `print_jobs (shipment_id) where type='label' and status<>'cancelled'` para cerrar la carrera entre `poll_label` y `sync` (hoy se comprueba antes de insertar).
- Credenciales de MasterShop (`integration_credentials` mastershop/CO) y `MASTERSHOP_WEBHOOK_PATH_SECRET`: las carga el dueño.
