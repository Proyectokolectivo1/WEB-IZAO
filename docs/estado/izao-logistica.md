# Bitácora de izao-logistica

## Hecho
- Antes: `@izao/mastershop` (líneas, pedido, estados, cliente, adaptador, mock), `1dc959b` contrato cola `carrier`, `20acdf2` jobs carrier, `607beec` webhook, D-026.
- `c611a9f` 23505 de `print_jobs_etiqueta_auto_unica_key` = ya existe (prueba en `carrier/fuente-postgrest.test.ts`); pre-chequeo solo `requested_by=auto`.
- `97c4dd5` billetera en el paquete (`wallet.ts`: decimales sin float, costos por pedido idempotentes, gastos, saldo, alerta) + mock con trampas (7 días, limit 50).
- `76aa22d` worker `jobs/sync/`: `mastershop.polling` (45 días, paginado hasta vacío) y `mastershop.billetera` (3 días). 24 pruebas contra el mock.
- `e29de8c` `reintentarCrearEnvio` (paquete) + `reintentarEnvioMasterShop(orderId, estado)` en `apps/web/app/api/webhooks/mastershop/cola.ts`.
- `942d1ad` contrato `docs/integraciones/agente-api.md` v1; `242e6f1` API `/api/agent/*` (heartbeat, jobs/claim, jobs/{id}/label, jobs/{id}/result, config). 19 pruebas.
- `9643c4d` `registerWebhook`/`setWebhookEnabled`/`registrarWebhooksIzao` (16 y 17; la respuesta repite la llave: se descarta).
- `0b8b261` D-027. lint/typecheck/test verdes.

## Para izao-infra (no edito cron.ts/index.ts)
- `cron.ts`: `upsertJobScheduler(JOB_POLLING_MASTERSHOP, { pattern: CRON_POLLING_MASTERSHOP, tz: 'America/Bogota' }, { name: JOB_POLLING_MASTERSHOP, data: {} })` y lo mismo con `JOB_BILLETERA_MASTERSHOP`/`CRON_BILLETERA_MASTERSHOP` (`7 * * * *`). Import de `./jobs/sync/index.js`. Quitar el PENDIENTE.
- `index.ts`, en `crearProcesadorSistema({...})`: `[JOB_POLLING_MASTERSHOP]: async () => pollingMasterShop(dependenciasPollingDesdeEnv(colaCarrier))`, `[JOB_BILLETERA_MASTERSHOP]: async () => billeteraMasterShop(dependenciasBilleteraDesdeEnv())`.
- La web escribe en `MEDIA_ROOT/agent-screenshots/` (volumen media de la web, lectura/escritura) y lee `MEDIA_ROOT/labels/`.

- `6513e22` webhooks guardados en `integration_webhooks` (izao-db `6b71294`); `remote_config` leído con columnas explícitas.

## Para izao-admin
- Botón "Reintentar": `reintentarEnvioMasterShop(orderId, order.status)` → `encolado | ya_pendiente | estado_invalido`; auditar.
- Módulo Agente: token aleatorio ≥ 32 `[A-Za-z0-9_-]`, guardar `hashTokenAgente(token)` (`app/api/agent/_lib/contrato.ts`); reimpresión = nuevo `print_job` con `requested_by: 'admin:<id>'`; "página de prueba" = `type: 'test_page'`.
- Registro de webhooks: `registrarWebhooksMasterShop(apiKey, ambiente)` de `app/api/webhooks/mastershop/registro.ts` (usa `SITE_URL` y el secreto; guarda en `integration_webhooks`; no repite los ya guardados).

## Pendiente
- Canal de alertas al admin (saldo bajo, impresión fallida, agente sin heartbeat > 5 min). Lista de empaque (`packing_list`).
- Avisar a izao-agente-windows del contrato v1 (no estaba disponible por mensaje).
- Pedido real de prueba en producción: solo con aprobación explícita del dueño.

## Siguiente paso exacto
Tras las columnas de izao-db: prueba de `estadoSaldo`/`guardarSaldo` reales y job "agente sin heartbeat".
