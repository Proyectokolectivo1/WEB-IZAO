# Bitácora izao-pagos

## Hecho
- 3a7e66b…1237af5 checkout y Wompi (D-024). 717f40b transiciones atómicas. ecfea17, 8ce6a59 abono, WhatsApp y `jobs/cod/` (D-025).
- 92713c2, b947512, 013d782 postgrest, eventos WhatsApp, barrido. 1a8c09d `@izao/core/metrics`. 58a9d68 `metrics.recompute_day` (D-033).
- 6a079e6 `@izao/addi` (D-031), `@izao/sistecredito` modo seguro (D-032). aabeda2 webhook y job de Addi. 4a61901 recálculo tras COD y barrido.
- cea1725 Addi en el checkout (D-034).
- Revisión de izao-revisor (2026-10-25):
  - 0c72b49 Sistecrédito no vendible: `ESTADO_INTEGRACION_METODO`, `metodoVendible`, `soloMetodosVendibles` en `@izao/core/contracts`; checkout y vista previa lo tratan como inactivo.
  - 761747b contrato del productor de `metrics.recompute_day` en `@izao/core/metrics` (`cola.ts`); la web encola tras crear el pedido y tras rechazo/reintento de Addi (`app/api/checkout/cola-metricas.ts`, best effort).
  - 05a94ea cliente de Addi: `Location` solo en `ADDI_ENDPOINTS[ambiente].dominiosRedireccion`; token compartido por proceso (D-036).
  - ceb228e aprobado sobre `cancelado`: nunca toca stock/canje/transportadora; reentrega → `sin_cambio`, dinero nuevo → alerta `pago_tras_cancelacion` (D-037).

- 6fb63be atribución en `POST /api/checkout`: `influencer_id`, `utm`, `click_ids` desde las cookies (`atribucionDelPedido`), influencer revalidado en la base (`FuenteCheckout.influencerDeCodigo`: código e influencer activos y del país).

## Contratos para compañeros
- izao-admin: en `guardarMetodo` bloquear activar un método con `!metodoVendible(method)` (`@izao/core/contracts`).
- izao-tienda: `lib/store/checkout-datos.ts` debe filtrar con `soloMetodosVendibles` (hoy muestra Sistecrédito si el panel lo activa; el servidor ya lo rechaza).
- izao-infra (pendiente de antes): pasar `recalculadorMetricasDesdeEnv(colaSistema)` a `dependenciasPagosDesdeEnv`, `dependenciasBarridoDesdeEnv`, `dependenciasCodDesdeEnv`.
- Dueños de transiciones: `encolarRecalculoPedido` ahora vive en `@izao/core/metrics` (el worker lo reexporta).
- izao-db: (2) `pedidos_por_vencer`/`pago_rechazado` con reserva; (3) seed de plantillas (D-025).

## Pendiente
- Cancelación de solicitudes de Addi al expirar o cambiar de método.
- [VERIFICAR] host real del `Location` de Addi en sandbox (D-036).
- Sistecrédito: documentación del contrato. Proveedor de correo. Sandbox real de Wompi/Meta/Addi. Deduplicación BullMQ contra Redis real.

## Siguiente paso exacto
Cancelación de solicitudes de Addi al expirar el pedido (barrido) y prueba en el sandbox de Addi con `.env.local`.

## Decisiones que necesitan al líder
- ¿`cancelado → requiere_reembolso` como estado visible? (hoy solo alerta, D-037; cambia §16 y la RPC de izao-db).
- Anexo B (D-025), proveedor de correo, documentación de Sistecrédito y contrato de Addi.
