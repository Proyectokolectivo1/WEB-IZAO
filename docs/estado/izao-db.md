# Bitácora izao-db
## Hecho
- Oleadas 0-1 (f63d558). T2.7 8da6bc2, 343bfbe. T2.8 8f33a8c. Colección 08d0a46. Admin catálogo 373d18d. T2.9 490cf03.
- `crear_pedido_checkout` 34cfe1f; 20261020213954 (0d237eb); 20261020214637 (cd24577). Espacios 20261020220958 + seed Parte 3.
- Abono COD 20261020221412 (pgTAP 23). `activar_plantilla_whatsapp` 20261021011746 (b3f163d, pgTAP 24). Seed plantillas: dueño.
- `cod_resend_max` 20261021013019 (pgTAP 25). Etiqueta auto única 20261021013134 (pgTAP 26). D-027 20261021015339 (pgTAP 27).
  Credencial activa única 20261021062843 (pgTAP 28, `activarCredencialIntegracionDb`). daily_sales_stats 20261025033707 (pgTAP 29).
- 20261025141454 tops del dashboard + `media.kind='expense'` (pgTAP 30 47/47). Rendimiento con 100 000 pedidos CO en 12 meses
  (en transacción revertida): ciudades 83 ms, deptos 75, productos 105, códigos 36, influencers 34, fuentes 70, guías 171;
  las 8 llamadas en serie 586 ms; 30 días 12 ms (Index Scan orders_country_atribucion_idx). Advisors: solo INFO.
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
## Pendiente
1. Rendimiento T2.7: explain (analyze, buffers) y p95 de 50 corridas por RPC del catálogo. 2. pgTAP 01–22 remoto.
3. Concurrencia de `crear_pedido_checkout` con dos sesiones (tests/concurrencia/run.sh). store_*: solo si izao-tienda lo pide.
4. Opcional (izao-admin): `admin_publicar_pagina`; cancelar + liberar stock en una transacción.
## Siguiente paso exacto: Pendiente 1 (explain de las RPC del catálogo) salvo nueva tarea del líder.
## Notas
- pgTAP por el MCP: `insert into tap(l) select ...` (temp), sin begin/rollback, cierre `raise exception 'RESUMEN %'` (deshace todo).
- Pruebas de carga igual: datos sintéticos + medición en un DO que termina en raise (nada queda en remoto).
- Versión: la de `list_migrations`. Tipos: JSON de `generate_typescript_types` (tool-results) → `types` a `src/types.ts` con python.
