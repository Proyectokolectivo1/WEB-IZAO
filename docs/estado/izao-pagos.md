# Bitácora izao-pagos

## Hecho
- 3a7e66b `POST /api/checkout/preview` y `POST /api/checkout` (§7.7, §10, §11, §17.1) en `apps/web/lib/checkout/`.
- 65c9228 Wompi pago completo (§12.2, D-024): `@izao/wompi`, `@izao/core/credentials`, `POST /api/checkout/pago`, webhook, job `payments`.
- (este commit) Correcciones de revisión del checkout: idempotencia por huella (`huella.ts`, SHA-256 de país, líneas, método, código efectivo y dirección; misma clave con otro contenido → 409 `IDEMPOTENCY_CONFLICT`, también en la carrera), `data_policy_version` validada contra la vigente (409 `DATA_POLICY_OUTDATED {current_version}`; sin política publicada → 503), limitador sin `clear()` (purga vencidas y expulsa las más antiguas), IP solo por `X-Real-IP` en producción, código normalizado a mayúsculas.

## Contrato
- Checkout: igual + `payment: {checkout_url, expires_at} | null` con `next_step = pay_wompi`; nuevo error 409 `{error:'DATA_POLICY_OUTDATED', current_version}`.
- `POST /api/checkout/pago` `{country, token}` → 200 `{checkout_url, expires_at, reused}`; 404; 409/410/503 `PAYMENT_NOT_AVAILABLE`; 400; 429.
- Cola `pagos`, job `wompi.transaccion` `{event_id, transaction_id}`, id `wompi.{event_id}`.

## Pedidos a otros agentes
- izao-db (1): `orders.checkout_request_hash text check (char_length = 64)`, insertarlo en `crear_pedido_checkout` desde `p.order.checkout_request_hash` (ya viaja en la fila; agregarlo a `pedidoCheckoutSchema` de `lib/db/checkout.ts`) y en `pedido_checkout_existente(p_clave, p_pais, p_hash)` devolver `idempotencia_conflicto` si ambos hashes existen y difieren. Hoy la comparación se hace en el servidor con lo persistido (líneas, método, `discount_code_text`, `shipping_*`).
- izao-db (2): `.eq('code', X)` no usa `discount_codes_upper_code_idx` (expresión). Crear `unique index discount_codes_code_key on discount_codes (code)` (equivalente por el CHECK `code = upper(code)`) o una RPC `buscar_codigo_descuento(p_code)` con `where upper(code) = upper(p_code)`. Verificado en la base: no hay índice sobre `code`.
- izao-db (3): marcar la página de tratamiento de datos (`pages.kind` o similar); hoy servidor y tienda la eligen por regex de slug/título.
- izao-db (4): índice único parcial `payments (provider, provider_reference)` y `aplicar_transicion_pedido` atómica.
- izao-tienda: manejar 409 `DATA_POLICY_OUTDATED` (mostrar la política vigente y pedir aceptar de nuevo); la versión de la tienda se cachea 300 s (`conCache 'legal'`): revalidar la etiqueta al publicar la página o habrá rechazos en esa ventana.
- izao-infra: Nginx del repo fija `X-Real-IP $remote_addr` (`infra/nginx/izao-proxy.conf`) y `web` escucha en 127.0.0.1: correcto. Registrar la cola `pagos` en el worker y pasar su build a bundler. Limitador en Redis (con 2 réplicas el de memoria se duplica).
- izao-logistica: `encolarTransportadora(orderId)`. izao-admin: cifrar con `cifrarCredenciales`.
- izao-admin: lint de `apps/web` falla en `lib/admin/catalogo/csv.ts:19` y `xlsx.ts:28` (no es de esta zona).

## Pendiente
- Sandbox real de Wompi (sin llaves en `.env.local`). Abono de contra entrega, Addi, Sistecrédito. UTM, `customer_id`, `gateway_fee_estimated`.

## Siguiente paso exacto
En espera del líder (no seguir con abono de contra entrega hasta nueva orden).
