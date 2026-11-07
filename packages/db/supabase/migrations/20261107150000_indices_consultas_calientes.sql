-- Índices para consultas calientes sin índice que las sirva (solo índices; no toca datos ni contratos).
--
-- Evidencia (2026-11-07): pg_stat_statements del proyecto + EXPLAIN (ANALYZE, BUFFERS) sobre un banco
-- sintético en tablas temporales (200 000 pedidos; copia de catalog_listing toda visible), con los índices
-- actuales replicados, antes y después de cada candidato. Advisors de rendimiento: sin FK sin índice.
--
-- 1. orders_created_at_idx — panel /admin/pedidos (`listarPedidos`): orden por created_at desc sin filtro
--    o solo con país/método/fechas, y la paginación. Antes: Seq Scan + sort de 200k filas (351 ms; con
--    país: 4,4 s por el índice de paid_at). Después: Index Scan (1,8 ms; 0,06 ms con país). También sirve
--    el rango de created_at de "pedidos sin pagar" en métricas (`cargarDatosPais`): 9,9 s → 21 ms.
-- 2. orders_status_created_idx — panel filtrado por estado + orden por fecha; conteo de
--    `error_transportadora` en /admin/sistema (33 ms → 5 ms, index only); barridos del worker por estado.
-- 3. orders_reserva_huerfana_idx — barrido `reservasHuerfanas` (status in (expirado, abandonado) y
--    stock_state = 'reserved'): Seq Scan 262 ms → 0,02 ms. Parcial: solo las pocas filas con reserva viva.
-- 4. orders_contact_email_idx — ficha de cliente del panel (`clientes/servidor.ts`: orders por
--    contact_email, citext): hoy Seq Scan de orders. Parcial: sin las filas sin correo.
-- 5. catalog_listing_country_slug_idx — ficha pública (`catalog_product`, 2.ª RPC más llamada): buscaba
--    por country_code y filtraba ~590 filas por slug (65–82 buffers) → Index Scan exacto (3 buffers).
--
-- Sin CONCURRENTLY: apply_migration corre en transacción; hoy orders tiene 4 filas y catalog_listing ~1000,
-- el bloqueo es de milisegundos. Peso estimado a 200k pedidos: ~4–6 MB por índice de orders.
--
-- Ya cubiertos (sin cambios): catálogo/filtros/búsqueda (§6.4), variant_countries y product_countries (PK),
-- descuentos (upper(code)), print_jobs (status, created_at), whatsapp_messages (status, scheduled_for),
-- webhook_events (provider, event_id) y created_at, order_events (order_id, created_at), pay_links,
-- pedidos_por_vencer (orders_stock_reserved_until_idx parcial), shipments (order_id, provider).

create index if not exists orders_created_at_idx
  on public.orders (created_at desc);

create index if not exists orders_status_created_idx
  on public.orders (status, created_at desc);

create index if not exists orders_reserva_huerfana_idx
  on public.orders (status)
  where stock_state = 'reserved';

create index if not exists orders_contact_email_idx
  on public.orders (contact_email)
  where contact_email is not null;

create index if not exists catalog_listing_country_slug_idx
  on public.catalog_listing (country_code, slug)
  where is_visible;
