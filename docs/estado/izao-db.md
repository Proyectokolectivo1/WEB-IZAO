# Bitácora izao-db
## Hecho
- Oleadas 0-1 (f63d558). T2.7 8da6bc2, 343bfbe. T2.8 8f33a8c. Colección 08d0a46. Admin catálogo 373d18d. T2.9 490cf03.
- Checkout 34cfe1f, 0d237eb, cd24577; pgTAP 01–36 remoto en verde (D-041); concurrencia remota ab23cd3. Advisors solo INFO.
- Aditivas: 20261102050729 chat; 20261105060857 media_settings; 20261106050343 focal (c134c53); 20261107195840 índices (a65978e, pgTAP 37 sin confirmar).
- D-052 vínculo MasterShop por país: 20261108233306 + fix 20261108233516 (aplicadas; pgTAP 38 20/20 y 18 26/26 remoto).
## Contratos vigentes (detalle en el commit de cada migración)
- `crear_pedido_checkout(p jsonb)` → `{ok, estado:'creado'|'existente'|'rechazado', order|motivo}` (motivos en 20261020213954).
- `pages.kind` (general, quienes_somos, envios, tratamiento_datos, terminos, devoluciones); única publicada por (país, kind) → 23505.
- `aplicar_transicion_pedido(p jsonb)` atómica (web: `aplicarTransicionPedidoDb`; worker: `POST /rest/v1/rpc/...` con `{p}`).
- `content_slots` por país: `nota_envio`, `valor_envio`, `medios_de_pago`, `asesoria`, `busquedas_populares` (on conflict do nothing).
- `pay_link_click(p_token)` (service_role) → `{ok, estado:'vigente'|'pagado'|'vencido', ...}`. Envoltorio `registrarClicPayLinkDb`.
- `whatsapp_messages_envio_unico_key` (order_id, template_id, scheduled_for) → 23505. `activar_plantilla_whatsapp(p_id, p_meta?)`.
- `cod_resend_max` ≥ 0 default 2. `print_jobs_etiqueta_auto_unica_key`. `carrier_wallet_*`. `print_agents.remote_config` jsonb {};
  `integration_webhooks` (únicos por prov/país/entorno/evento y prov/entorno/external_id).
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
- `site_settings.media_settings` jsonb default '{}'. `banners.focal_x/_y` smallint default 50, 0–100 (23514).
- D-052: `variant_countries.mastershop_product_id/_variant_id` int null = vínculo del país (fuente de verdad). CO rellenado,
  EC null. `product_variants.mastershop_*` DEPRECADAS = espejo de CO por triggers (`mastershop_vinculo_*`). Guardar/importar:
  `variants[].countries[].mastershop_*` (solo si la clave viene; null borra); regla de publicación en todo país con
  `carrier_provider='mastershop'`; error `{motivo:'sin_vinculo_mastershop', detalle:'SKU, …', paises:['EC']}` (+paises en import).
## Pendiente (además: tienda `registrarTurnoChatDb`; dueño política CO/EC; worker `media_file_deletions`; admin etiquetas stock)
0. Líder (con autorización): `reindex table concurrently` de orders/order_items/shipments (~95 MB de índices hinchados).
3. D-052: izao-pagos (fuente-supabase variantes por país), izao-admin (editor/importación/carga-real por país),
   izao-logistica (vinculacion-productos por país). Al terminar los tres: migración que retire product_variants.mastershop_*.
## Siguiente paso exacto: cuando pagos/admin/logística lean variant_countries, retirar espejo y columnas deprecadas (Pendiente 3).
## Notas
- pgTAP por el MCP: `python -I tests/remoto/tap2mcp.py <archivos>` → execute_sql; `RESUMEN %` deshace todo. Base con catálogo real.
- Versión: la de `list_migrations`. Tipos: JSON de `generate_typescript_types` (tool-results) → `types` a `src/types.ts` con python.
