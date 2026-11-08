# Bitácora de izao-logistica

## Hecho
- Paquete, cola `carrier`, webhook, billetera, polling, API del agente, registro de webhooks: `1dc959b` `20acdf2` `607beec` `97c4dd5` `76aa22d` `242e6f1` `9643c4d`; D-026/027/042/043/044.
- Prueba real 3084317 (Coordinadora, autoconfirmada a 3, cancelada a mano). Etiqueta 403 → `User-Agent` (D-044).
- `ef2ae16` Vinculación por SKU (D-050): `products.ts` (emparejar, `sqlVinculacion`), cliente `listAllProducts`/`getProduct`, *mock* de productos, CLI de vista previa `jobs/sync/vinculacion-productos.cli.ts` (solo lectura). Real: 2 productos MS vs 1030 variantes del *seed* → 0 emparejan.
- `46e1fd9`+`a4968ab` D-051: respaldo de etiqueta por el agente cuando el CDN bloquea la IP del VPS (403): `print_job` igual, `label_url` en `claim` (contrato 1.1), `urlEtiquetaSegura` anti-SSRF; polling encola sync si hay `label_url` sin copia local.
- D-052 MasterShop por país (EC con llave propia, USD): credencial CO+EC, jobs con la llave del país del pedido, polling/billetera por país, webhooks por país, mock con moneda. Hash: ver `git log -1 -- docs/estado/izao-logistica.md`.

## Para izao-infra
- Redesplegar el worker: el contenedor actual **no** tiene D-043 ni el arreglo del 403 (D-044); revisar también D-042.
- Confirmado bloqueo por IP (IZ-CO-000044). Redesplegar web + worker con D-051; el dueño pide a MasterShop liberar 169.58.102.153.
- La web escribe en `MEDIA_ROOT/agent-screenshots/` y lee `MEDIA_ROOT/labels/`.

## Para izao-admin
- D-051: detalle con enlace «Abrir etiqueta en MasterShop» si no hay copia local (`label_url` validada con `urlEtiquetaSegura`); reimprimir permitido con `label_url` válida.
- Cancelar con estado local desactualizado (1 local, 3 remoto): el 409 sale como «MasterShop no aceptó la cancelación». Mejor: si el error es `estado_no_editable`, mostrar «ya avanzó, cancélalo en MasterShop» (D-044).
- Botón "Reintentar": `reintentarEnvioMasterShop(orderId, order.status)`; auditar.
- Módulo Agente: token ≥ 32 `[A-Za-z0-9_-]`, guardar `hashTokenAgente(token)`; reimpresión = nuevo `print_job` `requested_by: 'admin:<id>'`.
- Registro de webhooks: `registrarWebhooksMasterShop(apiKey, ambiente)`.
- Vinculación en el panel: `MasterShopClient.listAllProductsWithVariants()` + `emparejarPorSku()` (vista previa) + `sqlVinculacion()` o UPDATE equivalente con confirmación y auditoría.

- D-052: `sondas.ts` → `new MasterShopClient({ apiKey, currency: currencyForCountry(pais) })` (detecta llave de otro país); `registrarWebhooksBd`/`listarWebhooksMasterShop`/página: permitir EC y pasar `registrar(apiKey, ambiente, { pais })`; `llaveMasterShopActiva(cliente, pais)` y cancelar con el país del pedido; ajustes por país `carrier_provider`, `carrier_auto_confirm`, `carrier_discount_mode`, `carrier_wallet_low_balance` (hoy no editables); regla de vínculo por país (tras izao-db).

## Para izao-db (D-052)
- Vínculo por país: `variant_countries.mastershop_product_id/mastershop_variant_id` (backfill CO desde `product_variants`), `admin_guardar_producto` exige vínculo en todo país con `carrier_provider='mastershop'`, checkout copia el vínculo del país del pedido (izao-pagos).

## Pendiente
- Vista previa 2 (catálogo real, 188 `IZAO-*`): MasterShop sigue con 2 productos → solo MEN-034/035 emparejan; SQL de 2 filas entregado al líder, sin aplicar. Dueño: subir los otros 186 a MasterShop (la API de esta llave lista 2). IZ-CO-000042/43: no se corrigen.
- Canal de alertas al admin (saldo bajo, impresión fallida, agente sin heartbeat > 5 min). Lista de empaque.
- Avisar a izao-agente-windows: contrato 1.1 (`label_url` en `claim`, descargar sin `Authorization`).
- Política de producto: con autoconfirmación, la ventana para cancelar por API casi no existe; las cancelaciones posteriores se hacen en el panel de MasterShop.

## Datos de prueba
- Ninguno abierto: 3076033 y 3084317 cancelados (9). No hay etiquetas de prueba guardadas en el VPS.

- EC: no activar `carrier_provider` en EC hasta el vínculo por país. Primer pedido real de EC (aprobación del usuario): verificar provincia/cantón, celular `09…`, CEDULA→CC, total con decimales.

## Siguiente paso exacto
Cuando el dueño cargue catálogo/SKU: `pnpm exec tsx --env-file=../web/.env.local src/jobs/sync/vinculacion-productos.cli.ts --salida <dir>` (desde `apps/worker`) y entregar el SQL. Además: esperar el redespliegue del worker (izao-infra) y verificar la primera descarga real de etiqueta; luego los pendientes de alertas y lista de empaque.
