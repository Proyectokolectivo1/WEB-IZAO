-- Pruebas pgtap · índices de consultas calientes (20261107150000): existen, columnas y parcialidad.
begin;
set local search_path = public, extensions;
select plan(10);

select has_index('public', 'orders', 'orders_created_at_idx', array['created_at'], 'orders (created_at desc)');
select has_index('public', 'orders', 'orders_status_created_idx', array['status', 'created_at'], 'orders (status, created_at desc)');
select has_index('public', 'orders', 'orders_reserva_huerfana_idx', array['status'], 'orders (status) parcial');
select has_index('public', 'orders', 'orders_contact_email_idx', array['contact_email'], 'orders (contact_email) parcial');
select has_index('public', 'catalog_listing', 'catalog_listing_country_slug_idx', array['country_code', 'slug'],
                 'catalog_listing (country_code, slug) parcial');

select is(
  (select pg_get_expr(i.indpred, i.indrelid) from pg_index i where i.indexrelid = 'public.orders_reserva_huerfana_idx'::regclass),
  '(stock_state = ''reserved''::text)', 'reserva huérfana: solo stock_state = reserved');
select is(
  (select pg_get_expr(i.indpred, i.indrelid) from pg_index i where i.indexrelid = 'public.orders_contact_email_idx'::regclass),
  '(contact_email IS NOT NULL)', 'correo: sin filas nulas');
select is(
  (select pg_get_expr(i.indpred, i.indrelid) from pg_index i where i.indexrelid = 'public.catalog_listing_country_slug_idx'::regclass),
  'is_visible', 'ficha: solo visibles');
select ok(
  (select (i.indoption[0] & 1) = 1 from pg_index i where i.indexrelid = 'public.orders_created_at_idx'::regclass),
  'created_at en orden descendente');
select ok(
  not (select i.indisunique from pg_index i where i.indexrelid = 'public.catalog_listing_country_slug_idx'::regclass),
  'ficha: índice no único (no cambia el contrato de refresh_catalog_listing)');

select * from finish();
rollback;
