-- Pruebas pgtap · B10: stock reservado <= stock, campos cod_* solo en contra entrega y refresco por cambios de variante.
begin;
set local search_path = public, extensions;
select plan(7);

insert into public.currencies (code, exponent, symbol, format_pattern)
  values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.products (id, name, slug, status)
  values ('a0000000-0000-0000-0000-0000000000b1', 'Integridad', 'integridad', 'active');
insert into public.product_countries (product_id, country_code, is_visible)
  values ('a0000000-0000-0000-0000-0000000000b1', 'CO', true);
insert into public.product_variants (id, product_id, sku, is_default, sort_order) values
  ('f0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'INT-1', true, 0),
  ('f0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'INT-2', false, 1);
insert into public.variant_countries (variant_id, country_code, price, compare_at_price, stock) values
  ('f0000000-0000-0000-0000-0000000000b1', 'CO', 100000, 150000, 5),
  ('f0000000-0000-0000-0000-0000000000b2', 'CO', 100000, 120000, 5);

-- Stock
select throws_ok($$update public.variant_countries set stock_reserved = 6 where variant_id = 'f0000000-0000-0000-0000-0000000000b1'$$,
  '23514', null, 'stock_reserved no puede superar stock');
select lives_ok($$update public.variant_countries set stock = 3, stock_reserved = 3 where variant_id = 'f0000000-0000-0000-0000-0000000000b1'$$,
  'stock_reserved = stock es valido');

-- cod_*
select throws_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name,
  contact_phone_e164, payment_method, status, subtotal, total_customer, cod_deposit_amount)
  values ('CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 90000, 90000, 10000)$$,
  '23514', null, 'abono cod en un pedido que no es contra entrega se rechaza');
select throws_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name,
  contact_phone_e164, payment_method, status, subtotal, total_customer, cod_collect_amount)
  values ('CO', 'COP', 'A', 'B', '+573000000001', 'addi', 'pendiente_pago', 90000, 90000, 5000)$$,
  '23514', null, 'recaudo cod en un pedido que no es contra entrega se rechaza');
select lives_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name,
  contact_phone_e164, payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount)
  values ('CO', 'COP', 'A', 'B', '+573000000001', 'cod', 'esperando_abono', 90000, 90000, 10000, 80000)$$,
  'contra entrega con abono y recaudo es valido');

-- Refresco al cambiar la variante por defecto: el tachado del listado sale de la variante mas barata (empate: la por defecto)
select is((select compare_at_price from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-0000000000b1'),
  150000::bigint, 'antes: la variante por defecto (INT-1) define el tachado');
update public.product_variants set is_default = false where id = 'f0000000-0000-0000-0000-0000000000b1';
update public.product_variants set is_default = true, sort_order = 0 where id = 'f0000000-0000-0000-0000-0000000000b2';
select is((select compare_at_price from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-0000000000b1'),
  120000::bigint, 'al cambiar is_default el listado se refresca solo');

select * from finish();
rollback;
