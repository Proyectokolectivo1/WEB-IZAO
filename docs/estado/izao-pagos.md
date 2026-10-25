# Bitácora izao-pagos

## Hecho
- 3a7e66b, 65c9228, d3b2632, 1237af5: checkout, Wompi pago completo (D-024), huella e idempotencia, política de datos vigente.
- 717f40b transiciones por `aplicar_transicion_pedido`. ecfea17 link de abono y `@izao/whatsapp` (D-025). 8ce6a59 `jobs/cod/` y webhook de WhatsApp.
- 92713c2 `jobs/postgrest.ts` compartido. b947512 `jobs/whatsapp/evento.ts`. 013d782 `pedidos.barrido`. `cod.reenviar` con tope `cod_resend_max`.
- 1a8c09d `@izao/core/metrics` (fórmulas §21.2, `FilaVentasDiarias`).
- 6a079e6 `@izao/addi` en verde (TS2304 del mock, prueba de máscara) y D-031 (Addi verificado contra el OpenAPI oficial de api-docs-sandbox.addi.com). `@izao/sistecredito`: esquema inicial, `validarPedidoSistecredito` y adaptador en modo seguro (D-032: sin documentación oficial no opera ni acepta webhooks).
- 58a9d68 `jobs/metrics/recalcular-dia.ts` + `fuente-postgrest.ts`: `metrics.recompute_day` y `metrics.recompute_recent` (D-033).

## Contrato (para izao-infra)
- Pagos/WhatsApp/COD/barrido/`cod.reenviar`: sin cambios (ver D-024, D-025 y commits anteriores).
- **Métricas** (de `./jobs/metrics/recalcular-dia.js`), cola `sistema`: `[JOB_METRICS_RECOMPUTE_DAY]: crearManejadorRecalculoDia(dependenciasMetricasDesdeEnv())` y `[JOB_METRICS_RECOMPUTE_RECENT]: crearManejadorRecalculoReciente(cola)`; cron nocturno `metrics.recompute_recent` (sugerido `30 3 * * *`, America/Bogota).
- Payload `{ date: 'YYYY-MM-DD', country_code: 'CO'|'EC' }`. Encolar solo con `encolarRecalculoDia`/`encolarRecalculoPedido` (deduplicación BullMQ, no `jobId`).
- Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY, SITE_URL.

## Pedidos a otros agentes
- izao-infra: registrar lo de "Contrato" (métricas nuevo).
- izao-db: (2) `pedidos_por_vencer` y `pago_rechazado` con reserva; (3) `seed.sql` de plantillas (D-025).
- izao-tienda: `/pagar/{token}`; ocultar Sistecrédito mientras `ESTADO_INTEGRACION_SISTECREDITO = 'pendiente_documentacion'`.
- izao-admin: panel de plantillas, cifrar credenciales `whatsapp`, formularios Addi/Sistecrédito desde los esquemas.
- izao-logistica / dueños de transiciones: llamar `encolarRecalculoPedido` tras cambiar un pedido.

## Pendiente
- Encolar `metrics.recompute_day` desde mis propios jobs (pagos, cod) tras cada transición.
- Addi: ruta `/api/webhooks/addi` (responder 200 con el mismo objeto), job `addi.callback`, creación en checkout, cancelación (`/v1/online-applications/cancellations`).
- Sistecrédito: documentación del contrato (dueño). Proveedor de correo para `CorreoRespaldo`. Sandbox real de Wompi/Meta.
- Probar la deduplicación de BullMQ contra un Redis real (hoy solo con cola falsa).

## Siguiente paso exacto
Webhook y job de Addi (`apps/web/app/api/webhooks/addi/route.ts`, `jobs/payments/addi-callback.ts`) con los mocks de `@izao/addi/mock`; luego encolar métricas tras transiciones.

## Decisiones que necesitan al líder
- Aprobar textos del Anexo B (D-025), proveedor de correo, y pedir al dueño la documentación de Sistecrédito (y la de Addi del contrato).
