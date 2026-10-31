# Bitácora izao-db
## Hecho
- Oleadas 0-1 (f63d558). T2.7 8da6bc2, 343bfbe. T2.8 8f33a8c. Colección 08d0a46. Admin catálogo 373d18d. T2.9 490cf03.
- `crear_pedido_checkout` 34cfe1f; 20261020213954 (0d237eb); 20261020214637 (cd24577). Espacios 20261020220958 + seed Parte 3.
- Abono COD 20261020221412 (pgTAP 23). `activar_plantilla_whatsapp` 20261021011746 (b3f163d, pgTAP 24). Seed plantillas: dueño.
- `cod_resend_max` 20261021013019 (pgTAP 25). Etiqueta auto única 20261021013134 (pgTAP 26). D-027 20261021015339 (pgTAP 27).
  Credencial activa única 20261021062843 (pgTAP 28, `activarCredencialIntegracionDb`). daily_sales_stats 20261025033707 (pgTAP 29).
- 20261025141454 tops del dashboard + `media.kind='expense'` (pgTAP 30 47/47; 8 tops en serie 586 ms con 100 000 pedidos).
- 20261025143040 RPC atómicas del panel (pgTAP 31 52/52; envoltorios `lib/db/panel-atomicas.ts`). Rating al moderar: trigger existente.
- 20261025191446 + 20261025191814 (revisión): cancelar devuelve stock pagado (D-035); anonimizar completo; cola
  `media_file_deletions`. pgTAP 32 34/34 y 31 ajustada. Advisors: solo INFO.
- 20261031043504 `chat_registrar_uso` (pgTAP 33 9/9): upsert con suma en una sentencia, sin comparar-y-cambiar.
## Contratos vigentes (detalle en el commit de cada migración)
- `crear_pedido_checkout(p jsonb)` → `{ok, estado:'creado'|'existente'|'rechazado', order|motivo}` (motivos en 20261020213954).
- `pages.kind` (general, quienes_somos, envios, tratamiento_datos, terminos, devoluciones); única publicada por (país, kind) → 23505.
- `aplicar_transicion_pedido(p jsonb)` atómica (web: `aplicarTransicionPedidoDb`; worker: `POST /rest/v1/rpc/...` con `{p}`).
- `content_slots` por país: `nota_envio`, `valor_envio`, `medios_de_pago`, `asesoria`, `busquedas_populares` (on conflict do nothing).
- `pay_link_click(p_token)` (service_role) → `{ok, estado:'vigente'|'pagado'|'vencido', ...}`. Envoltorio `registrarClicPayLinkDb`.
- `whatsapp_messages_envio_unico_key` (order_id, template_id, scheduled_for) → 23505. `activar_plantilla_whatsapp(p_id, p_meta?)`.
- `cod_resend_max` int ≥ 0 default 2. `print_jobs_etiqueta_auto_unica_key`. `carrier_wallet_*` en country_settings.
- `print_agents.remote_config` jsonb {}; `integration_webhooks` (únicos por prov/país/entorno/evento y prov/entorno/external_id).
- `integration_credentials_one_active_key`; `activar_credencial_integracion(p_id)` → `{ok, estado:'activada'|'ya_activa', ...}`.
- Tops (service_role; país CO|EC, fechas Bogotá inclusivas ≤ 731 días, límite 1..100 default 10; inválido → 22023):
  `metricas_top_ciudades`, `metricas_top_departamentos`, `metricas_top_productos`, `metricas_top_agrupado(…, p_dimension
  codigo|influencer|fuente, …)`, `metricas_panel_guias`. Firmas y columnas en la cabecera de 20261025141454.
- `orders.sale_source` text not null generada (stored) = `fuente_venta(utm, click_ids)` (igual a `fuenteDeVenta` del panel).
  No se escribe nunca (insert/update con la columna → error). `media.kind` admite `expense`.
- `anonimizar_cliente(p_id)` (definer) → `anonimizarClienteDb` (+ pagos_limpiados, webhooks_recortados, resenas, fotos_garantia);
  `cancelar_pedido(p)` → `cancelarPedidoDb` (+ stock_devuelto, unidades_devueltas, stock_retenido; eventos `stock_devuelto` y
  `stock_retenido`); `admin_publicar_pagina(p)` → `publicarPaginaDb`. Formas en la cabecera de cada migración.
- `media_file_deletions` (service_role): el worker borra `base_path` y `variants`, luego la fila (si falla: attempts+1, last_error).
- `chat_registrar_uso(p_costo_micros bigint, p_mensajes int = 1, p_ahora timestamptz = now())` → bigint total del mes (Bogotá).
## Pendiente
1. Rendimiento T2.7: explain (analyze, buffers) y p95 de 50 corridas por RPC del catálogo. 2. pgTAP 01–22 remoto.
3. Concurrencia de `crear_pedido_checkout` con dos sesiones (tests/concurrencia/run.sh). store_*: solo si izao-tienda lo pide.
4. Worker (izao-infra/izao-pagos): job que vacíe `media_file_deletions`. Admin: etiquetas de `stock_devuelto`/`stock_retenido`.
## Siguiente paso exacto: Pendiente 1 (explain de las RPC del catálogo) salvo nueva tarea del líder.
## Notas
- pgTAP por el MCP: `insert into tap(l) select ...` (temp), sin begin/rollback, cierre `raise exception 'RESUMEN %'` (deshace todo).
- Versión: la de `list_migrations`. Tipos: JSON de `generate_typescript_types` (tool-results) → `types` a `src/types.ts` con python.
