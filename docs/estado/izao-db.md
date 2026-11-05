# Bitácora izao-db
## Hecho
- Oleadas 0-1 (f63d558). T2.7 8da6bc2, 343bfbe. T2.8 8f33a8c. Colección 08d0a46. Admin catálogo 373d18d. T2.9 490cf03.
- Checkout 34cfe1f, 0d237eb, cd24577; espacios 20261020220958; pgTAP 23–29 (COD, plantillas, resend, etiqueta, D-027,
  credencial única, daily_sales_stats). 30 tops (47/47). 31 RPC atómicas del panel (52/52). 32 cancelar/anonimizar (34/34).
  33 `chat_registrar_uso` (9/9). Advisors siempre solo INFO.
- 20261102050729 `chat_registrar_turno` (pgTAP 34 14/14, `registrarTurnoChatDb`). pgTAP 01–12 remoto 150/150.
  Catálogo (520 prod., 800 filas): p95 de 50 corridas ≤ 5,2 ms por RPC, sin seq scan; sin índices nuevos. Advisors: solo INFO.
- pgTAP remoto 13–33 en verde (477/477; D-041). Concurrencia del checkout remota (ab23cd3, `tests/concurrencia/checkout-remoto.mjs`): N=20 × 3 rondas en verde; sin migración.
- 20261105060857 `site_settings.media_settings` (aditiva, autorizada por el dueño; pgTAP 35 7/7 + 11 9/9; advisors sin cambios).
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
- `chat_registrar_turno(p_session_id uuid, p_mensajes jsonb[1..20], p_ahora = now())` → int messages_count (P0002/22023).
- `site_settings.media_settings` jsonb not null default '{}' (check objeto); rangos los valida el panel. Sin link_type/link_product_id en banners (decidido).
## Pendiente
1. izao-tienda: usar `registrarTurnoChatDb`. 2. Dueño: publicar la política de datos de CO/EC (sin ella el checkout rechaza).
4. Worker (izao-infra/izao-pagos): job que vacíe `media_file_deletions`. Admin: etiquetas de `stock_devuelto`/`stock_retenido`.
## Siguiente paso exacto: ninguno propio; esperar tarea del líder (Pendiente 4 es de otros agentes).
## Notas
- pgTAP por el MCP: savepoint por archivo, conteos en secuencias temp, `raise exception 'RESUMEN %'` deshace todo.
  La base remota tiene catálogo real (520 prod.): las pruebas filtran por sus propias marcas/slugs.
- Versión: la de `list_migrations`. Tipos: JSON de `generate_typescript_types` (tool-results) → `types` a `src/types.ts` con python.
