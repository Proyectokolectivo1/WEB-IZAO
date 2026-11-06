# Bitácora izao-pagos

## Hecho
- 3a7e66b…1237af5 checkout y Wompi (D-024). 717f40b transiciones atómicas. ecfea17, 8ce6a59 abono, WhatsApp y `jobs/cod/` (D-025).
- 92713c2, b947512, 013d782 postgrest, eventos WhatsApp, barrido. 1a8c09d `@izao/core/metrics`. 58a9d68 `metrics.recompute_day` (D-033).
- 6a079e6 `@izao/addi` (D-031), `@izao/sistecredito` modo seguro (D-032). aabeda2 webhook y job de Addi. 4a61901 recálculo tras COD y barrido.
- cea1725 Addi en el checkout (D-034). Revisión 2026-10-25: 0c72b49 Sistecrédito no vendible (`metodoVendible`, `soloMetodosVendibles`); 761747b productor de `metrics.recompute_day`; 05a94ea `Location` de Addi (D-036); ceb228e aprobado sobre `cancelado` (D-037).
- 6fb63be atribución en `POST /api/checkout` (influencer revalidado). Barrido de solicitudes Addi de pedidos `expirado` (D-040).

## Contratos para compañeros
- izao-admin: en `guardarMetodo` bloquear activar un método con `!metodoVendible(method)` (`@izao/core/contracts`).
- izao-tienda: `lib/store/checkout-datos.ts` debe filtrar con `soloMetodosVendibles` (hoy muestra Sistecrédito si el panel lo activa; el servidor ya lo rechaza).
- izao-infra (pendiente de antes): pasar `recalculadorMetricasDesdeEnv(colaSistema)` a `dependenciasPagosDesdeEnv`, `dependenciasBarridoDesdeEnv`, `dependenciasCodDesdeEnv`.
- Dueños de transiciones: `encolarRecalculoPedido` ahora vive en `@izao/core/metrics` (el worker lo reexporta).
- izao-db: (2) `pedidos_por_vencer`/`pago_rechazado` con reserva; (3) seed de plantillas (D-025).

## Pendiente
- Reembolso de Addi (`POST /v1/online-applications/cancellations`) como acción del admin desde `requiere_reembolso` (D-040).
- izao-db (sugerencia): índice parcial `payments (provider, status) where purpose = 'financing'` si crece la tabla.
- [VERIFICAR] host real del `Location` de Addi en sandbox (D-036).
- Sistecrédito: documentación del contrato. Proveedor de correo. Sandbox real de Wompi/Meta/Addi. Deduplicación BullMQ contra Redis real.

## Prueba Wompi sandbox en producción (2026-11-06)
- Webhook: GET 405, firma inválida 401 sin registrar (log `firma_invalida`), credenciales cargadas. 0 eventos Wompi aún.
- Pedido de prueba IZ-CO-000041 (`249a4f9a…`), doble clic → 1 pedido, 1 pago `-P1`; Web Checkout abre en MODO DE PRUEBAS con monto y datos correctos.
- Vencimiento: 07:15 UTC barrido → `expirado`, `stock_state=released`, reserva 0. El pago `-P1` queda `created` (Wompi ya no lo acepta por `expiration-time`).
- Política: cliente bloquea sin aceptar; servidor 409 `DATA_POLICY_OUTDATED` (versión 1) y 400 sin `terms_and_data`; 0 pedidos extra.
- MasterShop seguro: las 1030 variantes sin `mastershop_product_id` → `buildCarrierOrder` lanza antes de la red → `error_transportadora`.
- WhatsApp seguro: 4 plantillas `draft`/inactivas → `plantilla_no_activa`, sin envío.
- Bloqueo: aprobar/rechazar en Wompi exige aceptar su reglamento y autorización de datos → necesita consentimiento del usuario (o que el dueño haga esos clics).

## Plantillas Meta (6da29d2, D-048)
- cobro_abono = `izao_pago_envio_inicial`, `es_CO`, vars nombre/pedido/abono/`pay_link_url`, sin botón. `validarEnvio` vs `validarPlantilla`. Link `/{pais}/pagar/{token}` (sin país = 404).
- Abono ya es fijo por país (`cod_deposit_amount`); prod CO = 10.000.
- Pendiente: UPDATE de la fila de prod (denegado al agente), izao-admin sincroniza `VARIABLES_PLANTILLA`/`VALORES_EJEMPLO` con `pay_link_url` (1 prueba roja en web) y `urlCobro` con país; textos de recordatorios y cancelado_24h del dueño.

## Siguiente paso exacto
Con el dueño: pagar IZ-CO-000041 (o uno nuevo) con Transferencia Bancolombia/QR sandbox eligiendo aprobado y rechazado; yo verifico `webhook_events`, `payments` y estado. Luego COD (link `/pagar/{token}`).

## Decisiones que necesitan al líder
- ¿`cancelado → requiere_reembolso` como estado visible? (hoy solo alerta, D-037; cambia §16 y la RPC de izao-db).
- Anexo B (D-025), proveedor de correo, documentación de Sistecrédito y contrato de Addi.
