# Bitácora izao-db

## Hecho
- Oleadas 0-1 (f63d558). T2.7 8da6bc2, 343bfbe. T2.8 8f33a8c. Colección 08d0a46. Admin catálogo 373d18d. T2.9 490cf03.
- `crear_pedido_checkout` 34cfe1f; 20261020213954 (0d237eb); 20261020214637 (cd24577). Espacios 20261020220958 + seed Parte 3.
- Abono COD 20261020221412 (pgTAP 23). Seed de plantillas: espera al dueño. `activar_plantilla_whatsapp` 20261021011746 (b3f163d,
  pgTAP 24 14/14). `pedidos_por_vencer` ya incluye `pago_rechazado → expirado` (20261019234041, A2, §16; pgTAP 14): sin cambio.

## Contratos vigentes (detalle en el commit de cada migración)
- `crear_pedido_checkout(p jsonb)` → `{ok, estado:'creado'|'existente'|'rechazado', order|motivo}`; motivos: `idempotencia_conflicto`,
  `en_proceso`, `sin_stock`+`faltantes`, `codigo_*`/`limite_*`, `sin_items`, `totales_inconsistentes`, `datos_invalidos`+`detalle`,
  `sin_politica_datos` (503), `politica_datos_desactualizada`+`version_vigente` (409). Envoltorio `crearPedidoCheckoutDb`.
- `orders.checkout_request_hash` (SHA-256 hex); `pedido_checkout_existente(p_clave, p_pais, p_hash)`.
- `pages.kind` (general, quienes_somos, envios, tratamiento_datos, terminos, devoluciones); única publicada por (país, kind) → 23505.
  `politica_datos_vigente(p_pais)`; `version` la sube el panel al publicar.
- `payments_provider_reference_key` único parcial; `aplicar_transicion_pedido(p jsonb)` atómica (web: `aplicarTransicionPedidoDb`/
  `aplicarEventoPedidoDb`; worker: `POST /rest/v1/rpc/aplicar_transicion_pedido` con `{p}`).
- `content_slots` por país (CO, EC), sin espacios globales; claves sembradas (activas, sin imagen):
  `nota_envio` (body), `valor_envio` (title = «Gratis»), `medios_de_pago` (title = alt; imagen la sube el dueño),
  `asesoria` (imagen la sube el dueño), `busquedas_populares` (body, una por línea: familias olfativas genéricas).
  Siembra con `on conflict (key, country_code) do nothing`: nunca pisa lo que edite el panel.
- `pay_link_click(p_token)` (service_role) → `{ok, estado:'vigente'|'pagado'|'vencido', order_id, order_number, clicks, expires_at,
  target_url solo si vigente}` | `{ok:false, motivo:'no_existe'|'datos_invalidos'}`. Envoltorio `registrarClicPayLinkDb`.
- `whatsapp_messages_envio_unico_key` unique (order_id, template_id, scheduled_for); NULL no choca; duplicado → 23505.
- `activar_plantilla_whatsapp(p_id, p_meta_template_id?)` (service_role) → `{ok, estado:'activada'(+anterior_id/version|null)|
  'ya_activa'|'aprobada_sin_activar'(+activa_id/version), id, version}` | `{ok:false, motivo:'no_existe'|'datos_invalidos'}`.

## Pendiente
1. Rendimiento T2.7: explain (analyze, buffers) y p95 de 50 corridas por RPC.
2. Cierre: pgTAP 01–22 remoto, advisors (solo INFO hoy), lint/typecheck/test.
3. Concurrencia de `crear_pedido_checkout` con dos sesiones (tests/concurrencia/run.sh). store_*: solo si izao-tienda lo pide.

## Siguiente paso exacto
- Pendiente 1 (explain de las RPC del catálogo) salvo nueva tarea del líder.

## Notas
- pgTAP por el MCP: aserciones → `insert into tap(l) select ...` (tabla temporal), sin begin/rollback, y terminar con
  `do $$ begin raise exception 'RESUMEN %' ... $$` (el MCP corre el lote en una transacción: el error deshace todo).
  Pruebas como anon: `set local role anon` dentro de un `do` que guarda el resultado con `set_config`.
- El MCP fija la versión de la migración al aplicar: renombrar el archivo local a la versión de `list_migrations`.
