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
- 2026-11-04 sonda real (solo lectura, desde izao-worker-1): credencial CO/production se descifra; products/orders.list/wallets 200. Arreglado (D-042): `hasNovelty` 0/1 y `listTimeoutMs` 45 s (listado tarda ~13 s). Webhooks 16/17 ya registrados por el dueño (51026/51027). Worker 68cdd45 ya corre `mastershop.polling`/`billetera` (billetera `procesado` desde 06:07 UTC).

## Para izao-infra
- Cron y procesadores de `mastershop.polling`/`billetera` ya cableados y en el VPS. Falta redesplegar con el arreglo D-042 (sin él, el polling falla al haber envíos abiertos).
- La web escribe en `MEDIA_ROOT/agent-screenshots/` y lee `MEDIA_ROOT/labels/`.

- Recálculo §21.4 (hallazgo del revisor): fuente carrier envuelta con `conRecalculoMetricas`; tarifa nueva sin transición y costos de billetera encolan `metrics.recompute_day`. Cableado mínimo en `apps/worker/src/index.ts` (avisado a izao-infra).
- `6513e22` webhooks guardados en `integration_webhooks` (izao-db `6b71294`); `remote_config` leído con columnas explícitas.

## Para izao-admin
- Botón "Reintentar": `reintentarEnvioMasterShop(orderId, order.status)` → `encolado | ya_pendiente | estado_invalido`; auditar.
- Módulo Agente: token aleatorio ≥ 32 `[A-Za-z0-9_-]`, guardar `hashTokenAgente(token)` (`app/api/agent/_lib/contrato.ts`); reimpresión = nuevo `print_job` con `requested_by: 'admin:<id>'`; "página de prueba" = `type: 'test_page'`.
- Registro de webhooks: `registrarWebhooksMasterShop(apiKey, ambiente)` de `app/api/webhooks/mastershop/registro.ts` (usa `SITE_URL` y el secreto; guarda en `integration_webhooks`; no repite los ya guardados).

## Pendiente
- Canal de alertas al admin (saldo bajo, impresión fallida, agente sin heartbeat > 5 min). Lista de empaque (`packing_list`).
- Avisar a izao-agente-windows del contrato v1 (no estaba disponible por mensaje).
- Pedido real de prueba en producción: solo con aprobación explícita del dueño.

- 2026-11-04 pedido real (D-043): modo A rechazado (400, nada creado) → modo B. **Creado MasterShop `idOrder 3076033` / `IZ-CO-PRUEBA-0001`**, estado 1 «Por Confirmar», sin guía (pide confirmar; alerta de bodega InterRapidisimo sin crear). No se creó producto en Izao. Arreglado `guide` opcional en el detalle. Script temporal en el VPS: `/tmp/izao/p.mjs` y `p2.mjs` (borrar tras cancelar).

## Datos de prueba creados (limpiar)
- MasterShop 3076033 (`IZ-CO-PRUEBA-0001`): **pendiente cancelar** con `{idStatus: 9}` según decida el líder (confirmar para ver etiqueta o cancelar ya).

## Siguiente paso exacto
Decisión del líder sobre 3076033: (a) cancelar ya: `docker exec -i izao-worker-1 node --input-type=module - cancelar 3076033 < /tmp/izao/p.mjs` y luego `estado 3076033`; o (b) el dueño crea la bodega InterRapidisimo, se confirma (1→2), se descarga la etiqueta (`etiqueta 3076033`) y se cancela (2→9). Redesplegar con el arreglo D-043.
