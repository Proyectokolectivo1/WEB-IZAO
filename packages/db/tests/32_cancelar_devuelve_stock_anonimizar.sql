-- Pruebas pgtap · 20261025191446: cancelar_pedido devuelve el stock confirmado (salvo envío recolectado) y
-- anonimizar_cliente limpia pagos, webhooks, reseñas y fotos de garantía; media_file_deletions con RLS.
begin;
set local search_path = public, extensions;
select plan(34);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('c3200000-0000-0000-0000-000000000001', 'Pgtap Treinta y dos', 'pgtap-32', 'active');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('c3210000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-000000000001', 'PG32-A', true),
  ('c3210000-0000-0000-0000-000000000002', 'c3200000-0000-0000-0000-000000000001', 'PG32-B', false);
insert into public.variant_countries (variant_id, country_code, price, stock) values
  ('c3210000-0000-0000-0000-000000000001', 'CO', 100000, 10),
  ('c3210000-0000-0000-0000-000000000002', 'CO', 50000, 5);

-- ---------------------------------------------------------------------------------------------------------
-- media_file_deletions
-- ---------------------------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.media_file_deletions'::regclass), 'media_file_deletions: RLS activo');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'media_file_deletions'), 0, 'media_file_deletions: sin políticas (denegado)');
select ok(not has_table_privilege('anon', 'public.media_file_deletions', 'select')
          and not has_table_privilege('authenticated', 'public.media_file_deletions', 'select')
          and has_table_privilege('service_role', 'public.media_file_deletions', 'insert'), 'media_file_deletions: solo service_role');

-- ---------------------------------------------------------------------------------------------------------
-- cancelar_pedido
-- ---------------------------------------------------------------------------------------------------------
insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
                           payment_method, status, subtotal, total_customer) values
  ('c3600000-0000-0000-0000-000000000001', 'PGTAP32-A', 'CO', 'COP', 'C', 'A', '+573005550001', 'wompi', 'en_preparacion', 200000, 200000),
  ('c3600000-0000-0000-0000-000000000002', 'PGTAP32-B', 'CO', 'COP', 'C', 'B', '+573005550002', 'wompi', 'enviado_transportadora', 50000, 50000),
  ('c3600000-0000-0000-0000-000000000003', 'PGTAP32-C', 'CO', 'COP', 'C', 'C', '+573005550003', 'wompi', 'en_preparacion', 100000, 100000),
  ('c3600000-0000-0000-0000-000000000004', 'PGTAP32-D', 'CO', 'COP', 'C', 'D', '+573005550004', 'wompi', 'requiere_reembolso', 100000, 100000),
  ('c3600000-0000-0000-0000-000000000005', 'PGTAP32-E', 'CO', 'COP', 'C', 'E', '+573005550005', 'wompi', 'requiere_reembolso', 150000, 150000);
insert into public.order_items (order_id, product_id, variant_id, sku, name_snapshot, quantity, unit_price) values
  ('c3600000-0000-0000-0000-000000000001', 'c3200000-0000-0000-0000-000000000001', 'c3210000-0000-0000-0000-000000000001', 'PG32-A', 'A', 2, 100000),
  ('c3600000-0000-0000-0000-000000000002', 'c3200000-0000-0000-0000-000000000001', 'c3210000-0000-0000-0000-000000000002', 'PG32-B', 'B', 1, 50000),
  ('c3600000-0000-0000-0000-000000000003', 'c3200000-0000-0000-0000-000000000001', 'c3210000-0000-0000-0000-000000000001', 'PG32-A', 'A', 1, 100000),
  ('c3600000-0000-0000-0000-000000000004', 'c3200000-0000-0000-0000-000000000001', 'c3210000-0000-0000-0000-000000000001', 'PG32-A', 'A', 1, 100000),
  ('c3600000-0000-0000-0000-000000000005', 'c3200000-0000-0000-0000-000000000001', 'c3210000-0000-0000-0000-000000000002', 'PG32-B', 'B', 1, 50000),
  ('c3600000-0000-0000-0000-000000000005', 'c3200000-0000-0000-0000-000000000001', null, 'PG32-BORRADA', 'Borrada', 1, 100000);
select is(public.confirmar_stock('c3600000-0000-0000-0000-000000000001') ->> 'estado', 'confirmed', 'A pagado: stock descontado');
select is(public.confirmar_stock('c3600000-0000-0000-0000-000000000002') ->> 'estado', 'confirmed', 'B pagado');
select is(public.confirmar_stock('c3600000-0000-0000-0000-000000000003') ->> 'estado', 'confirmed', 'C pagado');
-- D: pago tardío sin stock (nada que devolver). E: confirmado con una línea cuya variante se borró.
update public.orders set stock_state = 'released' where id = 'c3600000-0000-0000-0000-000000000004';
update public.orders set stock_state = 'confirmed' where id = 'c3600000-0000-0000-0000-000000000005';
update public.variant_countries set stock = stock - 1 where variant_id = 'c3210000-0000-0000-0000-000000000002';
insert into public.shipments (order_id, external_order_id, provider_order_id, provider_status_id) values
  ('c3600000-0000-0000-0000-000000000002', 'PGTAP32-B', 932101, 9),   -- cancelada en MasterShop: sin envío efectivo
  ('c3600000-0000-0000-0000-000000000003', 'PGTAP32-C', 932102, 5);   -- recolectada (estado interno aún sin sincronizar)
select results_eq($$ select stock from public.variant_countries where variant_id in ('c3210000-0000-0000-0000-000000000001', 'c3210000-0000-0000-0000-000000000002') order by variant_id $$,
                  $$ values (7), (3) $$, 'stock tras los pagos: A 10-2-1=7, B 5-1-1=3');

select is(public.cancelar_pedido('{"order_id":"c3600000-0000-0000-0000-000000000001","from_status":"en_preparacion","actor":"admin:pg32"}') - 'event_id',
          '{"ok": true, "order_id": "c3600000-0000-0000-0000-000000000001", "from_status": "en_preparacion", "to_status": "cancelado",
            "stock_estado": "released", "stock_liberado": false, "stock_devuelto": true, "unidades_devueltas": 2, "stock_retenido": null}'::jsonb,
          'en_preparacion pagado: cancela y devuelve 2 unidades');
select is((select stock from public.variant_countries where variant_id = 'c3210000-0000-0000-0000-000000000001'), 9, 'A: el stock vuelve (7+2)');
select is((select stock_state from public.orders where id = 'c3600000-0000-0000-0000-000000000001'), 'released', 'A: stock_state released');
select is((select payload from public.order_events where order_id = 'c3600000-0000-0000-0000-000000000001' and type = 'stock_devuelto'),
          '{"lineas": [{"sku": "PG32-A", "cantidad": 2, "variant_id": "c3210000-0000-0000-0000-000000000001"}], "no_devueltas": []}'::jsonb,
          'A: movimiento registrado en order_events (stock_devuelto)');
select is((select actor from public.order_events where order_id = 'c3600000-0000-0000-0000-000000000001' and type = 'stock_devuelto'), 'admin:pg32', 'A: el movimiento lleva el actor');
select is(public.cancelar_pedido('{"order_id":"c3600000-0000-0000-0000-000000000001","from_status":"en_preparacion","actor":"admin:pg32"}') ->> 'motivo',
          'estado_cambiado', 'cancelar dos veces: estado_cambiado');
select is((select stock from public.variant_countries where variant_id = 'c3210000-0000-0000-0000-000000000001'), 9, 'A: la segunda llamada no devuelve otra vez');

select is(public.cancelar_pedido('{"order_id":"c3600000-0000-0000-0000-000000000002","from_status":"enviado_transportadora","actor":"admin:pg32"}') ->> 'unidades_devueltas',
          '1', 'enviado_transportadora cancelado en MasterShop (9): devuelve');
select is((select stock from public.variant_countries where variant_id = 'c3210000-0000-0000-0000-000000000002'), 4, 'B: el stock vuelve (3+1)');

select is(public.cancelar_pedido('{"order_id":"c3600000-0000-0000-0000-000000000003","from_status":"en_preparacion","actor":"webhook:mastershop"}')
            - 'event_id' - 'order_id' - 'from_status' - 'to_status' - 'ok',
          '{"stock_estado": "confirmed", "stock_liberado": false, "stock_devuelto": false, "unidades_devueltas": 0, "stock_retenido": "envio_recolectado"}'::jsonb,
          'envío ya recolectado: cancela sin devolver');
select is((select stock from public.variant_countries where variant_id = 'c3210000-0000-0000-0000-000000000001'), 9, 'C: stock sin cambios');
select is((select payload from public.order_events where order_id = 'c3600000-0000-0000-0000-000000000003' and type = 'stock_retenido'),
          '{"motivo": "envio_recolectado", "provider_status_id": 5}'::jsonb, 'C: evento stock_retenido');

select is(public.cancelar_pedido('{"order_id":"c3600000-0000-0000-0000-000000000004","from_status":"requiere_reembolso","actor":"admin:pg32"}') ->> 'stock_devuelto',
          'false', 'requiere_reembolso sin stock confirmado: nada que devolver');
select ok(not exists (select 1 from public.order_events where order_id = 'c3600000-0000-0000-0000-000000000004' and type like 'stock_%'), 'D: sin movimiento de stock');

select is(public.cancelar_pedido('{"order_id":"c3600000-0000-0000-0000-000000000005","from_status":"requiere_reembolso","actor":"admin:pg32"}') ->> 'unidades_devueltas',
          '1', 'requiere_reembolso confirmado: devuelve lo que existe');
select is((select stock from public.variant_countries where variant_id = 'c3210000-0000-0000-0000-000000000002'), 5, 'E: B vuelve a 5');
select is((select payload -> 'no_devueltas' from public.order_events where order_id = 'c3600000-0000-0000-0000-000000000005' and type = 'stock_devuelto'),
          '[{"sku": "PG32-BORRADA", "motivo": "variante_inexistente", "cantidad": 1, "variant_id": null}]'::jsonb, 'E: la línea sin variante queda registrada como no devuelta');

-- ---------------------------------------------------------------------------------------------------------
-- anonimizar_cliente: pagos, webhooks, reseñas y fotos de garantía
-- ---------------------------------------------------------------------------------------------------------
insert into public.customers (id, country_code, first_name, last_name, email, phone_e164, created_at) values
  ('c3300000-0000-0000-0000-000000000001', 'CO', 'Lina', 'Uno', 'pgtap32-l1@example.com', '+573004440001', '2026-01-01');
insert into public.orders (id, number, country_code, currency_code, customer_id, contact_first_name, contact_last_name, contact_phone_e164,
                           contact_email, payment_method, status, subtotal, total_customer, created_at) values
  ('c3400000-0000-0000-0000-000000000001', 'PGTAP32-L1', 'CO', 'COP', 'c3300000-0000-0000-0000-000000000001', 'Lina', 'Uno', '+573004440001',
   'pgtap32-l1@example.com', 'wompi', 'entregado', 90000, 90000, '2026-02-01'),
  ('c3400000-0000-0000-0000-000000000002', 'PGTAP32-OTRO', 'CO', 'COP', null, 'Otra', 'Persona', '+573008880002',
   'pgtap32-otra@example.com', 'wompi', 'entregado', 70000, 70000, '2026-02-02');
insert into public.payments (order_id, provider, purpose, amount, currency_code, status, provider_transaction_id, raw_last_event) values
  ('c3400000-0000-0000-0000-000000000001', 'wompi', 'full', 90000, 'COP', 'approved', 'pg32-tx-1', '{"customer_email": "pgtap32-l1@example.com"}'),
  ('c3400000-0000-0000-0000-000000000002', 'wompi', 'full', 70000, 'COP', 'approved', 'pg32-tx-2', '{"customer_email": "pgtap32-otra@example.com"}');
insert into public.shipments (order_id, external_order_id, provider_order_id, provider_status_id) values
  ('c3400000-0000-0000-0000-000000000001', 'PGTAP32-L1', 932201, 8);
insert into public.webhook_events (id, provider, event_id, payload, error, created_at) values
  ('c3900000-0000-0000-0000-000000000001', 'wompi', 'pg32-e1', '{"data": {"transaction": {"id": "pg32-tx-1", "status": "APPROVED"}}}', 'x', '2026-02-01'),
  ('c3900000-0000-0000-0000-000000000002', 'mastershop', 'pg32-e2', '{"orders": [{"idOrder": 932201, "idStatus": 8}]}', null, '2026-02-03'),
  ('c3900000-0000-0000-0000-000000000003', 'whatsapp', 'pg32-e3', '{"entry": [{"changes": [{"value": {"contacts": [{"wa_id": "573004440001"}]}}]}]}', null, '2026-02-04'),
  ('c3900000-0000-0000-0000-000000000004', 'wompi', 'pg32-e4', '{"data": {"transaction": {"id": "pg32-tx-2"}}}', null, '2026-02-05'),
  ('c3900000-0000-0000-0000-000000000005', 'wompi', 'pg32-e5', '{"data": {"transaction": {"id": "pg32-tx-1"}}}', null, '2025-11-01');
insert into public.reviews (id, country_code, product_id, author_name, rating, status, order_id) values
  ('c3800000-0000-0000-0000-000000000001', 'CO', 'c3200000-0000-0000-0000-000000000001', 'Lina U.', 5, 'approved', 'c3400000-0000-0000-0000-000000000001'),
  ('c3800000-0000-0000-0000-000000000002', 'CO', 'c3200000-0000-0000-0000-000000000001', 'Otra P.', 4, 'approved', 'c3400000-0000-0000-0000-000000000002');
insert into public.media (id, kind, base_path, variants) values
  ('c3700000-0000-0000-0000-000000000001', 'warranty', 'warranty/2026/02/c37-1', '{"800": "warranty/2026/02/c37-1-800.webp"}'),
  ('c3700000-0000-0000-0000-000000000002', 'product', 'product/2026/02/c37-2', '{}');
insert into public.warranty_claims (number, order_id, country_code, customer_name, phone, email, reason, description, status, media_ids) values
  ('PGT32-G1', 'c3400000-0000-0000-0000-000000000001', 'CO', 'Lina Uno', '+573004440001', 'pgtap32-l1@example.com', 'otro', 'Foto', 'resuelta',
   '{c3700000-0000-0000-0000-000000000001,c3700000-0000-0000-0000-000000000002}');

select is(public.anonimizar_cliente('c3300000-0000-0000-0000-000000000001')
            - 'id' - 'estado' - 'mensajes_whatsapp' - 'leads' - 'direcciones' - 'deseos' - 'conversaciones' - 'cuenta_acceso_eliminada',
          '{"ok": true, "pedidos": 1, "garantias": 1, "pagos_limpiados": 1, "webhooks_recortados": 3, "resenas": 1, "fotos_garantia": 1}'::jsonb,
          'anonimizar: pagos, webhooks, reseñas y fotos');
select is((select raw_last_event from public.payments where provider_transaction_id = 'pg32-tx-1'), null::jsonb, 'raw_last_event vaciado');
select is((select raw_last_event ->> 'customer_email' from public.payments where provider_transaction_id = 'pg32-tx-2'), 'pgtap32-otra@example.com', 'pago de otra persona intacto');
select results_eq($$ select event_id, payload, error from public.webhook_events where id::text like 'c3900000%' and id <= 'c3900000-0000-0000-0000-000000000003' order by id $$,
                  $$ values ('pg32-e1'::text, '{"anonimizado": true}'::jsonb, null::text), ('pg32-e2', '{"anonimizado": true}', null), ('pg32-e3', '{"anonimizado": true}', null) $$,
                  'webhooks ligados (transacción, idOrder numérico, wa_id sin +) recortados; conservan event_id');
select is((select payload -> 'data' -> 'transaction' ->> 'id' from public.webhook_events where id = 'c3900000-0000-0000-0000-000000000004'), 'pg32-tx-2', 'webhook de otra persona intacto');
select is((select payload -> 'data' -> 'transaction' ->> 'id' from public.webhook_events where id = 'c3900000-0000-0000-0000-000000000005'), 'pg32-tx-1', 'webhook anterior al cliente: fuera de la ventana');
select results_eq($$ select author_name from public.reviews where id in ('c3800000-0000-0000-0000-000000000001', 'c3800000-0000-0000-0000-000000000002') order by id $$,
                  $$ values ('Cliente anónimo'::text), ('Otra P.') $$, 'reseña del pedido anonimizada; la ajena intacta');
select is((select media_ids from public.warranty_claims where number = 'PGT32-G1'), '{}'::uuid[], 'garantía sin fotos');
select ok(not exists (select 1 from public.media where id = 'c3700000-0000-0000-0000-000000000001')
          and exists (select 1 from public.media where id = 'c3700000-0000-0000-0000-000000000002'), 'foto de garantía borrada; media de otro tipo intacta');
select results_eq($$ select media_id, kind, base_path, variants, reason, attempts from public.media_file_deletions where media_id = 'c3700000-0000-0000-0000-000000000001' $$,
                  $$ values ('c3700000-0000-0000-0000-000000000001'::uuid, 'warranty'::text, 'warranty/2026/02/c37-1'::text,
                             '{"800": "warranty/2026/02/c37-1-800.webp"}'::jsonb, 'anonimizacion'::text, 0) $$,
                  'archivo físico encolado para el worker');

select * from finish();
rollback;
