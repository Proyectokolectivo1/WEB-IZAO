---
name: izao-contraentrega-whatsapp
description: Úsala al construir el flujo de contra entrega de Izao — abono por link de Wompi, mensajes por WhatsApp Cloud API, gestión y aprobación de plantillas en Meta, recordatorios, horario silencioso, abandono a las 24 horas, URL /pagar/{token} y reenvío de cobro.
---

# Contra entrega con abono por WhatsApp

Referencia: `docs/ESPECIFICACION.md` §13, Anexo B, §11 (montos).

## Flujo

1. Checkout contra entrega → `esperando_abono`, stock reservado hasta `created_at + cod_link_ttl_hours`.
2. Link de Wompi del abono (skill `izao-wompi`) + token `pay_links`.
3. Encolar `whatsapp.send` con plantilla `cobro_abono` (inmediato).
4. Página de confirmación con "Pagar abono ahora" (mismo link).
5. Programar recordatorios con `cod_reminder_offsets_minutes` (defecto 180, 720, 1260) como jobs retrasados con `jobId` `cod.reminder:{orderId}:{n}`.
6. Al aprobarse el abono: cancelar jobs pendientes del pedido, `abono_pagado`, `carrier.create`.
7. Job `cod.abandon:{orderId}` a las 24 h: si sigue `esperando_abono` → `abandonado`, liberar stock y código de descuento. **Nunca** llega a MasterShop.

## Horario silencioso

Configurable (defecto 21:00–07:00, zona del país). Un recordatorio que cae dentro se mueve a la hora de fin si aún queda ≥ 1 h de vigencia; si no, se omite.

## WhatsApp Cloud API

- `POST https://graph.facebook.com/{version}/{phone_number_id}/messages`, `type: template`, `language.code: es`, componentes `body` (parámetros en orden) y `button` (`sub_type: url`, `index: 0`, parámetro = token). Versión de Graph en el panel (`[VERIFICAR]` la vigente).
- Número destino en E.164 (`57…`, `593…`).
- Guardar `wa_message_id` y estado en `whatsapp_messages`.

## Plantillas editables

- El admin edita texto y botón con variables como fichas. Validar: variables consecutivas, sin variables al inicio/fin del texto (regla de Meta), texto transaccional.
- Guardar crea nueva versión y la envía a Meta: `POST /{waba_id}/message_templates`, categoría `UTILITY`, con ejemplos de variables. Nombre `{key}_v{n}`.
- La versión anterior sigue activa hasta que llegue `APPROVED` por webhook (`message_template_status_update`); entonces se activa la nueva. Rechazo → mostrar motivo en el panel.

## Webhook `/api/webhooks/whatsapp`

`GET` de verificación (`hub.challenge` con token del panel). `POST` validado con `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con `app_secret`). Procesa estados de mensajes y de plantillas.

## Fallos

Error de envío (p. ej. número sin WhatsApp): alerta en el pedido, correo con el link si hay correo, botón "Copiar link". Botón "Reenviar cobro" (admin y operador) solo si el link sigue vigente.

## `/pagar/{token}`

Vigente y sin pagar → redirección 302 al link de Wompi y `clicks++`. Pagado → página "Ya recibimos tu abono". Vencido → página con opción de escribir al asesor. Nunca expone el número de pedido completo sin el token.

## Pruebas

Reloj simulado (fake timers / jobs con tiempo inyectado): envío inmediato, 3 recordatorios, horario silencioso, cancelación al pagar, abandono a las 24 h, pago tardío, fallo de WhatsApp con respaldo por correo.
