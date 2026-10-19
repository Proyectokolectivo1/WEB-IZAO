-- Pruebas pgTAP · RLS y permisos de cliente (§6.1, §26.2, D-011)
-- Ejecutar con pg_prove o dentro de una transacción; todo se revierte al final.
begin;
set local search_path = public, extensions;
select plan(24);

-- Estructura
select is((select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0, 'todas las tablas de public tienen RLS');
select is((select count(*)::int from pg_policies where schemaname = 'public'), 6, 'solo existen las 6 politicas de cliente');
select policies_are('public', 'customers', array['customers_select_own','customers_update_own']);
select policies_are('public', 'addresses', array['addresses_select_own']);
select policies_are('public', 'wishlists', array['wishlists_select_own']);
select policies_are('public', 'orders', array['orders_select_own']);
select policies_are('public', 'order_items', array['order_items_select_own']);

-- Datos
insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into auth.users (id, aud, role, email) values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'u2@test.local');
insert into public.customers (id, auth_user_id, country_code, first_name, email) values
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'CO', 'Uno', 'u1@test.local'),
  ('c2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'CO', 'Dos', 'u2@test.local');
insert into public.addresses (customer_id, address1) values
  ('c1111111-1111-1111-1111-111111111111', 'Calle 1'), ('c2222222-2222-2222-2222-222222222222', 'Calle 2');
insert into public.products (id, name, slug) values ('a0000000-0000-0000-0000-000000000001', 'Prueba RLS', 'prueba-rls');
insert into public.wishlists (customer_id, product_id) values
  ('c1111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001'),
  ('c2222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001');
insert into public.orders (id, country_code, currency_code, customer_id, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer, notes_internal) values
  ('d1111111-1111-1111-1111-111111111111', 'CO', 'COP', 'c1111111-1111-1111-1111-111111111111', 'Uno', 'A', '+573000000001', 'wompi', 'pagado', 90000, 90000, 'interna'),
  ('d2222222-2222-2222-2222-222222222222', 'CO', 'COP', 'c2222222-2222-2222-2222-222222222222', 'Dos', 'B', '+573000000002', 'wompi', 'pagado', 50000, 50000, 'interna');
insert into public.order_items (order_id, sku, name_snapshot, quantity, unit_price, unit_cost) values
  ('d1111111-1111-1111-1111-111111111111', 'S1', 'P1', 1, 90000, 40000),
  ('d2222222-2222-2222-2222-222222222222', 'S2', 'P2', 1, 50000, 20000);

-- Cliente 1 autenticado
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select results_eq('select id from public.customers', $$values ('c1111111-1111-1111-1111-111111111111'::uuid)$$, 'customers: el cliente solo ve su perfil');
select is((select count(*)::int from public.addresses), 1, 'addresses: solo las propias');
select is((select count(*)::int from public.wishlists), 1, 'wishlists: solo la propia');
select results_eq('select id from public.orders', $$values ('d1111111-1111-1111-1111-111111111111'::uuid)$$, 'orders: solo los propios');
select results_eq('select sku from public.order_items', $$values ('S1'::text)$$, 'order_items: solo los de sus pedidos');
select throws_ok('select notes_internal from public.orders', '42501', null, 'orders: notas internas no visibles');
select throws_ok('select click_ids, utm, gateway_fee_estimated, product_cost_total from public.orders', '42501', null, 'orders: click IDs, comisiones y costos no visibles');
select throws_ok('select unit_cost from public.order_items', '42501', null, 'order_items: costo unitario no visible');
select lives_ok($$update public.customers set first_name = 'Uno editado'$$, 'customers: actualiza su perfil');
select throws_ok($$update public.customers set auth_user_id = '22222222-2222-2222-2222-222222222222'$$, '42501', null, 'customers: no puede cambiar auth_user_id');
select throws_ok($$insert into public.addresses (customer_id, address1) values ('c1111111-1111-1111-1111-111111111111', 'X')$$, '42501', null, 'addresses: sin escritura directa');
select throws_ok('select count(*) from public.integration_credentials', '42501', null, 'integration_credentials: sin privilegios para el cliente');
-- intenta editar al otro cliente (RLS lo filtra)
update public.customers set first_name = 'hackeado' where id = 'c2222222-2222-2222-2222-222222222222';
reset role;
select is((select first_name from public.customers where id = 'c2222222-2222-2222-2222-222222222222'), 'Dos', 'customers: no puede editar el perfil de otro');
select is((select first_name from public.customers where id = 'c1111111-1111-1111-1111-111111111111'), 'Uno editado', 'customers: su edicion quedo guardada');

-- Anónimo
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from public.customers', '42501', null, 'anon: sin acceso a customers');
select throws_ok('select * from public.orders', '42501', null, 'anon: sin acceso a orders');
select throws_ok('select count(*) from public.products', '42501', null, 'anon: products sin privilegios');
reset role;

select * from finish();
rollback;
