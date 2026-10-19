---
name: izao-wompi
description: Úsala al implementar pagos con Wompi en Izao — pago completo por Web Checkout, link de pago del abono de contra entrega, firma de integridad, webhook transaction.updated y conciliación de pagos.
---

# Wompi (Colombia)

Referencia: `docs/ESPECIFICACION.md` §12.2. Confirmar cada campo contra `https://docs.wompi.co` antes de codificar (`[VERIFICAR]`).

## Credenciales (panel)

Llave pública, llave privada, secreto de eventos, secreto de integridad, ambiente. Base URL: sandbox `https://sandbox.wompi.co/v1`, producción `https://production.wompi.co/v1`.

## Pago completo

1. El servidor crea el pedido (`pendiente_pago`) y un `payment` (`purpose = full`).
2. Referencia única por intento: `{orders.number}-P{n}`.
3. Monto en centavos: `total_customer × 100` (COP no tiene decimales en la base).
4. Firma de integridad: `sha256(referencia + monto_en_centavos + moneda + [fecha_expiración] + secreto_integridad)`.
5. Redirigir al Web Checkout con llave pública, moneda, monto, referencia, firma, `redirect-url` a `/{pais}/pedido/{public_token}` y datos del cliente prellenados.
6. La página de retorno **no** confía en los parámetros de la URL: consulta el estado en el servidor.
7. TTL: `pending_payment_ttl_minutes`; job que expira y libera stock.

## Link de abono (contra entrega)

- `POST /payment_links` con llave privada: `name`, `description`, `single_use: true`, `collect_shipping: false`, `currency`, `amount_in_cents`, `expires_at`, `redirect_url`, `sku = orders.number`.
- Guardar `payment_link_id` y la URL `https://checkout.wompi.co/l/{id}`.
- Crear `pay_links` con token corto para la URL de marca `/pagar/{token}`.

## Webhook `/api/webhooks/wompi`

- Evento `transaction.updated`.
- Checksum: concatenar los valores de `signature.properties` (rutas dentro de `data`), luego `timestamp`, luego el secreto de eventos; `sha256` y comparar en tiempo constante con `signature.checksum` / header `X-Event-Checksum`.
- Idempotencia por id de transacción + estado.
- Reconsultar `GET /transactions/{id}`.
- Asociar por `reference` (pago completo) o `payment_link_id` (abono).
- `APPROVED` → `pagado` / `abono_pagado` → evento de compra para píxeles → job `carrier.create`.
- `DECLINED`/`ERROR`/`VOIDED` → `pago_rechazado` (solo pago completo).
- Abono aprobado sobre pedido `abandonado`: reactivar si hay stock; si no, `requiere_reembolso` + alerta.

## Comisiones

`fee = monto × fee_pct + fee_fixed`, más `fee_tax_pct` sobre la comisión. Guardar en `payments.fee_amount` para métricas.

## Pruebas

Sandbox con tarjetas y estados de prueba de Wompi: aprobado, rechazado, error. Vector fijo para la firma de integridad y el checksum del evento. Prueba de doble entrega del mismo webhook.
