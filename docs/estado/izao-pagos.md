# Bitácora izao-pagos

## Hecho
- 3a7e66b…1237af5 checkout y Wompi (D-024). 717f40b transiciones atómicas. ecfea17, 8ce6a59 abono, WhatsApp y `jobs/cod/` (D-025).
- 92713c2, b947512, 013d782 postgrest, eventos WhatsApp, barrido. 1a8c09d `@izao/core/metrics`. 58a9d68 `metrics.recompute_day` (D-033).
- 6a079e6 `@izao/addi` (D-031), `@izao/sistecredito` modo seguro (D-032). aabeda2 webhook y job de Addi. 4a61901 recálculo tras COD y barrido.
- cea1725 Addi en el checkout (D-034). Revisión 2026-10-25: 0c72b49 Sistecrédito no vendible (`metodoVendible`, `soloMetodosVendibles`); 761747b productor de `metrics.recompute_day`; 05a94ea `Location` de Addi (D-036); ceb228e aprobado sobre `cancelado` (D-037).
- 6fb63be atribución en `POST /api/checkout` (influencer revalidado). Barrido de solicitudes Addi de pedidos `expirado` (D-040).
- 7c60d43 checkout lee el vínculo MasterShop de `variant_countries` del país (D-052); `product_variants.mastershop_*` ya no se lee. RPC y `crear-pedido.ts` sin cambios. `serverExternalPackages: ['bullmq']` quita el aviso de `@valkey/valkey-glide` del build (compilación sin avisos).
- Rama fix/conciliacion-pagos-wompi (D-059): conciliación Wompi en `pedidos.barrido` (cada 2 min), pago tardío `expirado → pagado` con stock, alerta `pago_aprobado_sin_aplicar`, GET PostgREST con reintento. Recupera solos IZ-CO-000051/52 tras desplegar el worker.
- Rama feat/cancelar-error-transportadora (D-061): `error_transportadora → cancelado` (motivo obligatorio para admin), migración 20261127180000 (`cancelar_pedido` + alerta `reembolso_manual_pendiente`, sin aplicar), pgTAP 41, panel con aviso de reembolso.
- caebb15 (rama feat/aviso-cookies) Purchase de CAPI con opt-in estricto: checkout guarda `marketing_consent` desde `izao_consent`; job `sin_consentimiento` sin llamar a Meta (D-057). Desplegar la migración antes del worker.

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

## Plantillas Meta (6da29d2 D-048, a2e75fb D-049)
- cobro_abono/30m/5h/cancelado_24h alineadas (es_CO, sin botón, link en {{4}}). Job `cod.aviso_cancelacion` desde abandono y barrido. Prod: cobro_abono activa (líder); las otras 3 + offsets {30,300} = SQL entregado al líder tras desplegar a2e75fb. izao-admin: sumar `pedido_cancelado_24h` al panel.

## Siguiente paso exacto
D-061: el líder aplica 20261127180000 y corre pgTAP 41 (no se ejecutó local: sin Supabase CLI); luego despliega la web.
Tras desplegar D-059: verificar 51/52 con la consulta de solo lectura del reporte; confirmar en sandbox la forma del 200 de `GET /v1/transactions?reference=` ([VERIFICAR] de D-059).
Antes:
Con el dueño: pagar IZ-CO-000041 (o uno nuevo) con Transferencia Bancolombia/QR sandbox eligiendo aprobado y rechazado; yo verifico `webhook_events`, `payments` y estado. Luego COD (link `/pagar/{token}`).

## Decisiones que necesitan al líder
- ¿`cancelado → requiere_reembolso` como estado visible o acción «Marcar reembolsado»? (hoy alerta, D-037 y D-061).
- Anexo B (D-025), proveedor de correo, documentación de Sistecrédito y contrato de Addi.
