# Bitácora izao-pagos

## Hecho
- 3a7e66b `POST /api/checkout/preview` y `POST /api/checkout` (§7.7, §10, §11, §17.1) en `apps/web/lib/checkout/`.
- 65c9228 Wompi pago completo (§12.2, D-024): `@izao/wompi`, `@izao/core/credentials`, `POST /api/checkout/pago`, webhook, job `payments`.
- d3b2632 Correcciones de revisión del checkout: idempotencia por huella (`huella.ts`, SHA-256 de país, líneas, método, código efectivo y dirección; misma clave con otro contenido → 409 `IDEMPOTENCY_CONFLICT`, también en la carrera), `data_policy_version` validada contra la vigente (409 `DATA_POLICY_OUTDATED {current_version}`; sin política publicada → 503), limitador sin `clear()` (purga vencidas y expulsa las más antiguas), IP solo por `X-Real-IP` en producción, código normalizado a mayúsculas.
- (este commit) Integración de 0d237eb (izao-db): la huella viaja y se guarda en la RPC y se compara la persistida (`checkout_request_hash`; pedidos sin ella, por contenido); `versionPoliticaDatos` = `politicaDatosVigenteDb` (sin regex); motivos de la base `politica_datos_desactualizada` → 409 `DATA_POLICY_OUTDATED {current_version}` (versión de la base), `sin_politica_datos` → 503, `idempotencia_conflicto` → 409.

## Contrato
- Checkout: igual + `payment: {checkout_url, expires_at} | null` con `next_step = pay_wompi`; nuevo error 409 `{error:'DATA_POLICY_OUTDATED', current_version}`.
- `POST /api/checkout/pago` `{country, token}` → 200 `{checkout_url, expires_at, reused}`; 404; 409/410/503 `PAYMENT_NOT_AVAILABLE`; 400; 429.
- Cola `pagos`, job `wompi.transaccion` `{event_id, transaction_id}`, id `wompi.{event_id}`.

## Pedidos a otros agentes
- izao-db (4): índice único parcial `payments (provider, provider_reference)` y `aplicar_transicion_pedido` atómica.
- izao-tienda: `lib/store/checkout-datos.ts` aún elige la política por regex: usar `pages.kind = 'tratamiento_datos'` (si difiere del servidor, el cliente recibe 409). Manejar 409 `DATA_POLICY_OUTDATED` (mostrar la política vigente y pedir aceptar de nuevo); la versión de la tienda se cachea 300 s (`conCache 'legal'`): revalidar la etiqueta al publicar la página o habrá rechazos en esa ventana.
- izao-infra: Nginx del repo fija `X-Real-IP $remote_addr` (`infra/nginx/izao-proxy.conf`) y `web` escucha en 127.0.0.1: correcto. Registrar la cola `pagos` en el worker y pasar su build a bundler. Limitador en Redis (con 2 réplicas el de memoria se duplica).
- izao-logistica: `encolarTransportadora(orderId)`. izao-admin: cifrar con `cifrarCredenciales`.
- izao-admin: typecheck de `apps/web` falla en `lib/admin/contenido/paginas-servidor.ts` (sin seguimiento, no es de esta zona).

## Pendiente
- Sandbox real de Wompi (sin llaves en `.env.local`). Abono de contra entrega, Addi, Sistecrédito. UTM, `customer_id`, `gateway_fee_estimated`.

## Siguiente paso exacto
En espera del líder (no seguir con abono de contra entrega hasta nueva orden).
