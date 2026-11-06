# Bitácora de izao-logistica

## Hecho
- Paquete `@izao/mastershop` (líneas, pedido, estados, cliente, adaptador, mock con trampas), cola `carrier` (`1dc959b`, `20acdf2`), webhook (`607beec`), D-026/D-027.
- `c611a9f` 23505 de etiqueta automática = ya existe. `97c4dd5` billetera. `76aa22d` jobs `mastershop.polling`/`billetera`. `e29de8c` reintento de envío.
- `942d1ad` contrato `docs/integraciones/agente-api.md` v1; `242e6f1` API `/api/agent/*`. `9643c4d`/`6513e22` registro de webhooks (16/17) en `integration_webhooks`.
- `6d77b62` D-042 (`hasNovelty` 0/1, listados 45 s). `e18c20a` D-043 (modo B; `guide` opcional en el detalle).
- `f8903ed` D-044: la transportadora no se elige por API. 3076033 cancelado por el dueño.
- Prueba real 3084317 (`IZ-CO-PRUEBA-0002`, la ejecutó el líder): Coordinadora (favorita de la cuenta) respetada, guía 75070781750; MasterShop la **autoconfirmó a 3**; `PUT 9` → 409; cancelada a mano por el dueño (9). Scripts de `/tmp/izao` borrados por el líder.
- Etiqueta 403: CDN sin `User-Agent` → arreglado en `almacen-etiquetas.ts` (D-044).
- `ef2ae16` Vinculación por SKU (D-050): `products.ts` (emparejar, `sqlVinculacion`), cliente `listAllProducts`/`getProduct`, *mock* de productos, CLI de vista previa `jobs/sync/vinculacion-productos.cli.ts` (solo lectura). Real: 2 productos MS vs 1030 variantes del *seed* → 0 emparejan.

## Para izao-infra
- Redesplegar el worker: el contenedor actual **no** tiene D-043 ni el arreglo del 403 (D-044); revisar también D-042.
- Tras desplegar, `[VERIFICAR]` una descarga de etiqueta desde el VPS; si sigue 403 con UA, es bloqueo por IP (pedirlo a MasterShop).
- La web escribe en `MEDIA_ROOT/agent-screenshots/` y lee `MEDIA_ROOT/labels/`.

## Para izao-admin
- Cancelar con estado local desactualizado (1 local, 3 remoto): el 409 sale como «MasterShop no aceptó la cancelación». Mejor: si el error es `estado_no_editable`, mostrar «ya avanzó, cancélalo en MasterShop» (D-044).
- Botón "Reintentar": `reintentarEnvioMasterShop(orderId, order.status)`; auditar.
- Módulo Agente: token ≥ 32 `[A-Za-z0-9_-]`, guardar `hashTokenAgente(token)`; reimpresión = nuevo `print_job` `requested_by: 'admin:<id>'`.
- Registro de webhooks: `registrarWebhooksMasterShop(apiKey, ambiente)`.
- Vinculación en el panel: `MasterShopClient.listAllProductsWithVariants()` + `emparejarPorSku()` (vista previa) + `sqlVinculacion()` o UPDATE equivalente con confirmación y auditoría.

## Pendiente
- Dueño: cargar el catálogo real en Izao y/o crear en MasterShop los productos con el mismo SKU; luego repetir la vista previa. IZ-CO-000042/43: `order_items` sin vínculo (cancelar o corregir a mano).
- Canal de alertas al admin (saldo bajo, impresión fallida, agente sin heartbeat > 5 min). Lista de empaque.
- Avisar a izao-agente-windows del contrato v1.
- Política de producto: con autoconfirmación, la ventana para cancelar por API casi no existe; las cancelaciones posteriores se hacen en el panel de MasterShop.

## Datos de prueba
- Ninguno abierto: 3076033 y 3084317 cancelados (9). No hay etiquetas de prueba guardadas en el VPS.

## Siguiente paso exacto
Cuando el dueño cargue catálogo/SKU: `pnpm exec tsx --env-file=../web/.env.local src/jobs/sync/vinculacion-productos.cli.ts --salida <dir>` (desde `apps/worker`) y entregar el SQL. Además: esperar el redespliegue del worker (izao-infra) y verificar la primera descarga real de etiqueta; luego los pendientes de alertas y lista de empaque.
