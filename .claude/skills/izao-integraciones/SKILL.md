---
name: izao-integraciones
description: Úsala antes de construir cualquier integración externa de Izao (Wompi, Addi, Sistecrédito, WhatsApp, MasterShop, OpenRouter, Meta Ads, píxeles) — credenciales cifradas en el panel, adaptadores, webhooks, colas BullMQ, reintentos e idempotencia.
---

# Patrón común de integraciones

Referencia: `docs/ESPECIFICACION.md` §3, §12.1, §14.1, §26.

## Credenciales

- Cada proveedor declara su esquema en `packages/integrations/{proveedor}/credentials.ts`: campos, cuáles son secretos, ambiente (`sandbox`/`production`), país.
- El panel genera el formulario desde ese esquema y guarda en `integration_credentials` cifrado con AES-256-GCM (`APP_ENCRYPTION_KEY` del `.env`, IV aleatorio por registro, *auth tag* guardado).
- `masked_preview` con los últimos 4 caracteres. Jamás devolver el valor completo al navegador ni escribirlo en logs (redactar con un *serializer* de logger).
- Botón "Probar conexión" que llama `testCredentials()` del adaptador y guarda `last_test_ok`.
- Lectura en servidor con caché en memoria de 60 s; se invalida al guardar.

## Adaptadores

Interfaces en `packages/integrations/types.ts` (`PaymentProvider`, `CarrierProvider`, `MessagingProvider`, `LLMProvider`). La lógica de negocio solo conoce la interfaz; el registro elige implementación por país y método. Ecuador debe poder conectarse escribiendo solo un adaptador nuevo.

## Webhooks

Ruta `apps/web/app/api/webhooks/{proveedor}/route.ts`:
1. Leer el cuerpo **crudo** (necesario para firmas).
2. Verificar firma o secreto; si falla → `401` y registro con `signature_valid = false`.
3. Insertar en `webhook_events` con `(provider, event_id)` único; si ya existe → `200` sin reprocesar.
4. Encolar job y responder `200` en < 1 s.
5. El job reconsulta el estado en la API del proveedor antes de cambiar el pedido.

## Jobs (BullMQ en `apps/worker`)

- Colas por dominio: `payments`, `whatsapp`, `carrier`, `print`, `media`, `metrics`, `sync`, `maintenance`.
- `jobId` determinista (`carrier.create:{orderId}`) para evitar duplicados.
- Reintentos exponenciales; tras agotar, estado de error visible en el pedido y alerta al admin.
- Cada job escribe en `order_events` lo que hizo.
- Cambios de estado del pedido solo mediante `transitionOrder(orderId, to, actor, payload)` de `packages/core/order-state`, que valida transiciones (§16) con bloqueo de fila (`select … for update`).

## Errores y límites

- Respetar cabeceras de *rate limit* del proveedor; en `429`, reprogramar según `Reset`.
- Timeouts explícitos (10 s por defecto) en todo `fetch` saliente.
- Mensajes de error del proveedor se guardan completos en el evento, pero al cliente solo se muestra un texto amable.

## Pruebas

Cada adaptador con *mocks* que reproducen respuestas reales documentadas (éxito, error de validación, duplicado, timeout) y prueba de verificación de firma con vectores fijos.
