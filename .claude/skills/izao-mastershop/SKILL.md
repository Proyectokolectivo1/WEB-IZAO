---
name: izao-mastershop
description: Úsala al trabajar con la API de MasterShop en Izao — crear, confirmar o cancelar pedidos, vincular productos, obtener guía y etiqueta PDF, webhooks y polling de estados, billetera y costos reales de envío.
---

# MasterShop

Referencia: `docs/ESPECIFICACION.md` §14. Documentación oficial: `https://documenter.getpostman.com/view/33212980/2sB3WnxNAk`. Al empezar esta fase, descarga la colección completa (JSON de Postman) a `docs/integraciones/mastershop.postman.json` y confirma los valores de `idWebhook` y el cuerpo de las notificaciones.

## Básico

Base `https://prod.api.mastershop.com`, header `ms-api-key`, JSON. Respetar `RateLimit-*`; en `429` esperar `RateLimit-Reset`.

## Trampas documentadas (cubrirlas con pruebas)

- `POST /api/orders/list` **sin filtros devuelve solo los últimos 7 días**: enviar siempre `startDate`.
- `limit` > 50 se recorta en silencio a 50: paginar hasta respuesta vacía, no hasta "menos que el límite".
- `externalOrderId` con guion bajo no se puede consultar: números de pedido solo con letras, números y guiones (`IZ-CO-000123`).
- Crear un pedido repetido responde `500` con "Código 409 - La orden ya existe": tratarlo como éxito y consultar.
- `PUT` con `502`: **no reintentar**; consultar y seguir según el estado real. `409` por edición concurrente: reintentar en 5 s.
- `order_transaction.total` debe ser **exactamente** `Σ price × quantity + Σ additional_charge.value`.
- Todas las claves del pedido son obligatorias aunque admitan `null` (`company`, `zip`, `address2`).
- `documentType`/`documentNumber`: los dos o ninguno. Tipos: CC, NIT, CE, DIE, NITEXT, PAS, RC, TE, TI.
- `currency` debe ser legal en el país de la dirección.
- Nombres solo letras y espacios; teléfono nacional.
- `GET /api/orders/return/{id}` solo responde en estado 10; el estado de la devolución es `idStatusReturn`.

## Crear pedido

Construir con `buildCarrierLines` (skill `izao-motor-precios`). `payment_method` `cod` o `pia`. `id_product`/`id_variant` = vínculo de la variante. `notes` con número de pedido y referencia del abono; `tags` `web` + `cod-abono` o `prepago`.

## Ciclo

`carrier.create` → (si "confirmar automáticamente") `PUT {idStatus: 2}` → `carrier.poll_label` cada 2 min hasta `orderLogistics.carrierTracking.shippingLabel` → descargar PDF a `MEDIA_ROOT/labels/` → crear `print_job`.

## Sincronización

- Webhook en `/api/webhooks/mastershop/{MASTERSHOP_WEBHOOK_PATH_SECRET}`; el cuerpo no se usa como verdad: reconsultar el pedido.
- Polling cada 10 min con `startDate` = hace 45 días para pedidos no finalizados.
- Mapear estados con la tabla de §14.6 (no existe el 7). Guardar `hasNovelty` y `alerts`.
- Registro de webhooks desde el panel con un clic (`POST /api/webhooks`, `idProduct: null`).

## Billetera

Job horario `POST /api/wallets/movements/list` (últimos 3 días, con `startDate`): asignar a cada pedido por `idOrder` los conceptos "Cobro por Envío", "Cobro por Devolución", "Comisión de plataforma", "Cobro por envío mensaje de WhatsApp". Movimientos sin pedido → `expenses` categoría "MasterShop" con `external_ref = idBalanceMovement`.

## Vinculación de productos

Buscador en el panel con `GET /api/products?search=…` y detalle `?includeAllVariations=true`. Sin vínculo, la variante no se publica en Colombia.

## Pruebas

Servidor *mock* con todas las trampas de arriba. En producción, antes del lanzamiento: crear un pedido real de bajo valor, verificar etiqueta y cancelarlo con `{ "idStatus": 9 }`. Probar ahí si `additional_charge` negativo es aceptado para elegir modo A o B.
