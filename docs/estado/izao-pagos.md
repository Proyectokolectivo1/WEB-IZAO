# Bitácora izao-pagos

## Hecho
- 3a7e66b, 65c9228, d3b2632, 1237af5: checkout, Wompi pago completo (D-024), huella e idempotencia, política de datos vigente (`politicaDatosVigenteDb`).
- 717f40b transiciones por `aplicar_transicion_pedido`. ecfea17 link de abono y `@izao/whatsapp` (D-025). 8ce6a59 `jobs/cod/` y webhook de WhatsApp.
- 92713c2 `jobs/postgrest.ts` (cliente compartido, SQLSTATE en errores, credenciales, `aplicarTransicionRpc`); `cod/fuente-postgrest.ts` (`FuenteCod` + `FuenteBarrido`); `dependenciasCodDesdeEnv(programar, correoRespaldo?)`.
- b947512 `jobs/whatsapp/evento.ts`: estados de mensajes solo avanzan (update condicional); `failed` → alerta `whatsapp_fallido {plantilla,codigo,correo}` + correo de respaldo (interfaz `CorreoRespaldo`, sin proveedor); `APPROVED` activa versión nueva/desactiva anterior (no si la activa es más nueva); `REJECTED` → `meta_rejection_reason`; `PAUSED/DISABLED` → `paused`. Token `/pagar` 128 bits.
- 013d782 `jobs/cod/barrido.ts` (`pedidos.barrido`): vence por `pedidos_por_vencer`, libera reservas huérfanas, encola `cod.iniciar` para `esperando_abono` sin `pay_links`.

- cod.reenviar ("Reenviar cobro"): reenvía `cobro_abono` con `scheduled_for = solicitado_en`; tope `country_settings.cod_resend_max`; silencio → reprograma.

## Contrato (para izao-infra)
- `index.ts`: `createWorker(COLA_WHATSAPP, crearProcesadorWhatsApp(dependenciasWhatsAppDesdeEnv()), conn)` desde `./jobs/whatsapp/evento.js`.
- Cola `sistema`: job `JOB_BARRIDO_PEDIDOS` (`pedidos.barrido`) → `barrerPedidos(dependenciasBarridoDesdeEnv(colaCod, (id) => cancelarJobsCod(colaCod, id)))`; cron `CRON_BARRIDO_PEDIDOS` (`*/5 * * * *`, America/Bogota). De `./jobs/cod/barrido.js`.
- `cod.reenviar` (izao-admin): cola `contraentrega` (`COLA_COD`), job `JOB_COD_REENVIAR` = `cod.reenviar`, payload `{ order_id: uuid, solicitado_en: ISO UTC con Z }` (`DatosJobCodReenviar`), `jobId: jobIdCodReenviar(orderId, solicitadoEn)` = `cod.reenviar.{uuid}.{epoch ms}`, `attempts: 4`, backoff exponencial. Lo consume el mismo `crearProcesadorCod`. Reemplaza el `cod.iniciar` del botón (con id fijo no reenvía).
- Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, APP_ENCRYPTION_KEY, SITE_URL.

## Pedidos a otros agentes
- izao-db: (1) hecho: `activar_plantilla_whatsapp` (b3f163d) ya usada por el worker. (2) `pedidos_por_vencer` no incluye `pago_rechazado` con reserva (core permite `pago_rechazado → expirado`); confirmar si debe. (3) `seed.sql` de plantillas (D-025). (4) Columna `country_settings.cod_resend_max integer not null default 2 check (>= 0)` editable en el panel; sin ella `cod.reenviar` no envía y alerta `reenvio_sin_tope`.
- izao-infra: registrar lo de "Contrato".
- izao-tienda: `/pagar/{token}` y "Pagar abono ahora" (pendiente anterior).
- izao-admin: panel de plantillas, "Copiar link de cobro"/"Reenviar cobro", cifrar credenciales `whatsapp`.

## Pendiente
- Proveedor de correo para `CorreoRespaldo`. Endpoint "Reenviar cobro". Sandbox real de Wompi/Meta (sin llaves). Addi, Sistecrédito, UTM, `customer_id`.

## Siguiente paso exacto
Esperar registro de izao-infra y probar en sandbox con un evento real de Meta (`message_template_status_update` y `failed`); luego Addi (§12.3, `[VERIFICAR]` con la documentación del dueño).

## Decisiones que necesitan al líder
- Aprobar textos del Anexo B (D-025) y elegir proveedor de correo para el respaldo del cobro.
