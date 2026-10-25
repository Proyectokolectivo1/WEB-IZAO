# Bitácora izao-pagos

## Hecho
- 3a7e66b, 65c9228, d3b2632, 1237af5: checkout, Wompi pago completo (D-024), huella e idempotencia, política de datos.
- 717f40b transiciones atómicas. ecfea17 link de abono y `@izao/whatsapp` (D-025). 8ce6a59 `jobs/cod/` y webhook WhatsApp.
- 92713c2 `jobs/postgrest.ts`. b947512 `jobs/whatsapp/evento.ts`. 013d782 `pedidos.barrido`. `cod.reenviar`.
- 1a8c09d `@izao/core/metrics`. 6a079e6 `@izao/addi` (D-031) y `@izao/sistecredito` modo seguro (D-032). 58a9d68 `metrics.recompute_day` (D-033).
- aabeda2 webhook `/api/webhooks/addi` (Basic auth, `webhook_events`, encola, 200 con el mismo objeto) y job `addi.callback`; aprobación compartida con Wompi (`jobs/payments/aprobacion.ts`); `conRecalculoMetricas` (`jobs/metrics/tras-transicion.ts`).
- 4a61901 recálculo de métricas tras transiciones de contra entrega y barrido.
- cea1725 Addi en el checkout (`lib/checkout/pago-addi.ts`, `fuente-addi-supabase.ts`, `http.ts`), recargo 10 % y código retirado (ya en pricing), CC/correo/celular antes de crear el pedido. D-034.

## Contrato (para izao-infra) — cambio en el arranque del worker
- `addi.callback` corre en la cola `pagos` ya registrada: no requiere cola ni cron nuevos. `dependenciasPagosDesdeEnv` ya incluye las dependencias de Addi.
- Recálculo de métricas: crear `const recalcular = recalculadorMetricasDesdeEnv(cola)` (de `./jobs/metrics/tras-transicion.js`, `cola` = sistema) y pasarlo como último argumento opcional:
  `dependenciasPagosDesdeEnv(encolarTransportadora(colaCarrier), (id) => cancelarJobsCod(colaCod, id), recalcular)`,
  `dependenciasBarridoDesdeEnv(colaCod, (id) => cancelarJobsCod(colaCod, id), recalcular)`,
  `dependenciasCodDesdeEnv(programadorCod(colaCod), undefined, recalcular)`. Sin él solo corrige el nocturno.
- Métricas, pagos, COD, barrido: sin otros cambios (D-024, D-025, D-033).

## Pedidos a otros agentes
- izao-infra: lo de "Contrato" (pasar `recalcular`).
- izao-db: (2) `pedidos_por_vencer` y `pago_rechazado` con reserva; (3) `seed.sql` de plantillas (D-025).
- izao-tienda: `/pagar/{token}`; ocultar Sistecrédito (`pendiente_documentacion`); con `pay_addi` redirigir a `payment.checkout_url`; si es `null` o `POST /api/checkout/pago` responde `rechazado_entidad`/`datos_cliente`, ofrecer otro método; `INVALID_INPUT` con rutas `document.type`, `contact.email`, `contact.phone` para Addi.
- izao-admin: plantillas, cifrar credenciales `whatsapp`, formularios Addi/Sistecrédito desde los esquemas.
- izao-logistica / dueños de transiciones: `conRecalculoMetricas` o `encolarRecalculoPedido` tras cambiar un pedido.

## Pendiente
- Cancelación de solicitudes de Addi (`/v1/online-applications/cancellations`) al expirar o cambiar de método.
- Recálculo de métricas desde la web (`pago_rechazado → pendiente_pago` del reintento): hoy solo el nocturno.
- Sistecrédito: documentación del contrato. Proveedor de correo para `CorreoRespaldo`. Sandbox real de Wompi/Meta/Addi.
- Probar la deduplicación de BullMQ contra un Redis real.

## Siguiente paso exacto
Cancelación de solicitudes de Addi al expirar el pedido (barrido) y prueba en el sandbox de Addi con `.env.local`.

## Decisiones que necesitan al líder
- Anexo B (D-025), proveedor de correo, documentación de Sistecrédito y contrato de Addi.
- TTL de financiación: la solicitud de Addi vence con la reserva (60 min); aprobación tardía → `requiere_reembolso` (D-034).
