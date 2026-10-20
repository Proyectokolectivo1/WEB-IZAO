# Bitácora izao-pagos

## Hecho
- 3a7e66b, 65c9228, d3b2632, 1237af5: checkout (`preview`, `checkout`, `pago`), Wompi pago completo (D-024), huella e idempotencia, política de datos vigente.
- 717f40b Transiciones por `aplicar_transicion_pedido` en worker y web.
- ecfea17 Link de abono `crearLinkPago` (`@izao/wompi`, `POST /v1/payment_links`) y paquete `@izao/whatsapp`: plantillas como datos (`validarPlantilla` con reglas de Meta, `mensajePlantilla`, `solicitudCreacion`, `PLANTILLAS_SEMILLA`), cliente Graph v26.0, credenciales, mock sin red, firma `X-Hub-Signature-256`, `interpretarWebhook`, nombres de colas. D-025.
- 8ce6a59 Worker `jobs/cod/` (`cod.iniciar`, `cod.recordatorio`, `cod.abandono`, plan con horario silencioso por zona, `programadorCod`, `cancelarJobsCod`, `crearProcesadorCod`); rama `cod_deposit` en `wompi-transaccion.ts`; checkout de contra entrega encola `cod.iniciar` (`payment: null`); `GET/POST /api/webhooks/whatsapp` con firma, `webhook_events` y cola `whatsapp`.

## Contrato
- Checkout contra entrega: 201 `next_step = pay_cod_deposit`, `payment: null`; `/pagar/{token}` queda en `pay_links` segundos después.
- Colas: `pagos` (`wompi.transaccion`), `contraentrega` (`cod.iniciar|recordatorio|abandono`, ids `cod.*.{orderId}[.{n}]`), `whatsapp` (`whatsapp.evento {event_id}`, id `wa.{event_id}`).
- `dependenciasPagosDesdeEnv(encolarTransportadora, cancelarJobsCod?)` (segundo opcional).
- `payments` del abono: `provider_reference = {número}-A{n}`, `payment_link_id`, `checkout_url = https://checkout.wompi.co/l/{id}`.

## Pedidos a otros agentes
- izao-db: (1) `seed.sql` de plantillas: textos y `variables_map` de `PLANTILLAS_SEMILLA` (`recordatorio_abono_2` y `_final` empezaban con variable; `_final` renumerado a `{1:nombre,2:pedido,3:vence,4:abono}`). (2) Función `pay_link_click(token)` atómica para `clicks++`. (3) Índice `whatsapp_messages (order_id, template_id, scheduled_for)` único para idempotencia del envío.
- izao-infra: registrar colas `contraentrega` (`crearProcesadorCod`) y `whatsapp` en el worker; pasar `(id) => cancelarJobsCod(colaCod, id)` como segundo argumento de `dependenciasPagosDesdeEnv`. Limitador en Redis.
- izao-tienda: `/pagar/{token}` (302 al `target_url` si vigente y sin pagar; "Ya recibimos tu abono"; vencido → asesor) y botón "Pagar abono ahora" leyendo `pay_links` del pedido (aparece unos segundos después del checkout). Pendiente anterior: 409 `DATA_POLICY_OUTDATED`.
- izao-admin: panel de plantillas con `validarPlantilla` y `solicitudCreacion` + `crearPlantilla` (`{key}_v{n}`); "Copiar link de cobro" y "Reenviar cobro"; cifrar credenciales `whatsapp` con `cifrarCredenciales`. Typecheck de `paginas-servidor.ts` (anterior).

## Pendiente
- `FuenteCod` PostgREST + `dependenciasCodDesdeEnv` (worker) y job `whatsapp.evento` (estados de `whatsapp_messages`, `failed` asíncrono → alerta + correo, `APPROVED` activa la nueva versión y desactiva la anterior, rechazo guarda `meta_rejection_reason`).
- Barrido cron: `esperando_abono` sin `pay_links` (Redis caído en el checkout) y `pedidos_por_vencer` (expiración de pago completo).
- Correo de respaldo (no hay proveedor de correo definido). "Reenviar cobro" (endpoint). Sandbox real de Wompi/Meta (sin llaves). Addi, Sistecrédito, UTM, `customer_id`.

## Siguiente paso exacto
Pruebas primero de `apps/worker/src/jobs/cod/fuente-postgrest.ts` (patrón de `payments/fuente-postgrest.ts`: pedido con `countries.timezone` y `country_settings`, `abonos`, `reservarAbono` con 23505 → duplicado, `pay_links`, `whatsapp_templates` activa por `key`, `whatsapp_messages` con `whatsapp_templates.key`, `liberar_stock`/`liberar_canje`, `aplicar_transicion_pedido` con `fechas.abandoned_at`); luego `jobs/whatsapp/evento.ts` con pruebas.

## Decisiones que necesitan al líder
- Aprobar el ajuste de textos del Anexo B (D-025) y el proveedor de correo para el respaldo del cobro.
