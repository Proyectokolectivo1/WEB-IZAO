# Bitácora izao-db

## Hecho
- Oleadas 0 y 1 (última f63d558). T2.7 RPC catálogo: 8da6bc2, 343bfbe. T2.8 `lib/db/`: 8f33a8c. Colección y stock_bajo: 08d0a46.
- `admin_guardar_producto` / `admin_importar_catalogo` + `lib/db/admin-catalogo`: 373d18d. T2.9 fixture de imágenes: 490cf03.
- `crear_pedido_checkout`: 34cfe1f. Pedidos (1-3): 20261020213954, pgTAP 20/19: 0d237eb. Pedido (4): 20261020214637, pgTAP 21: cd24577.
- Espacios de la tienda: 20261020220958 (solo datos) + seed.sql Parte 3, pgTAP 22 (12/12 remoto). Commit «feat(db): espacios de contenido…».
- Abono COD (pedidos 2 y 3 de izao-pagos): 20261020221412, pgTAP 23 (16/16 remoto), `lib/db/pay-links.ts` («feat(db): clic de pay_link…»). Pedido 1 (seed de plantillas): espera al dueño.
- `activar_plantilla_whatsapp`: 20261021011746, pgTAP 24 (14/14 remoto), `lib/db/plantillas-whatsapp.ts` («feat(db): activar_plantilla_whatsapp…»).
  `pedidos_por_vencer` ya incluye `pago_rechazado → expirado` desde 20261019234041 (A2, §16 tabla de estados; pgTAP 14); sin cambio.

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
3. Prueba de concurrencia de `crear_pedido_checkout` con dos sesiones (tests/concurrencia/run.sh, local).
4. store_*: no se crean salvo pedido de izao-tienda.

## Siguiente paso exacto
- Pendiente 1 (explain de las RPC del catálogo) salvo nueva tarea del líder.

## Notas
- pgTAP por el MCP: aserciones → `insert into tap(l) select ...` (tabla temporal), sin begin/rollback, y terminar con
  `do $$ begin raise exception 'RESUMEN %' ... $$` (el MCP corre el lote en una transacción: el error deshace todo).
  Pruebas como anon: `set local role anon` dentro de un `do` que guarda el resultado con `set_config`.
- El MCP fija la versión de la migración al aplicar: renombrar el archivo local a la versión de `list_migrations`.
