-- Pruebas pgtap · B2: number de pedidos y garantías opcional para la app (default vacío + trigger).
begin;
set local search_path = public, extensions;
select plan(5);

select is((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.orders'::regclass and a.attname = 'number'), '''''::text', 'orders.number tiene default vacio');
select is((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.warranty_claims'::regclass and a.attname = 'number'), '''''::text', 'warranty_claims.number tiene default vacio');

insert into public.currencies (code, exponent, symbol, format_pattern)
  values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;

-- sin number: el trigger lo asigna
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name,
  contact_phone_e164, payment_method, status, subtotal, total_customer)
  values ('d0000000-0000-0000-0000-0000000000b2', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 1000);
select matches((select number from public.orders where id = 'd0000000-0000-0000-0000-0000000000b2'),
  '^IZ-CO-[0-9]{6}$', 'pedido sin number recibe IZ-CO-000000');
-- con number explicito: se respeta
insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name,
  contact_phone_e164, payment_method, status, subtotal, total_customer)
  values ('d0000000-0000-0000-0000-0000000000b3', 'IZ-CO-MANUAL1', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 1000);
select is((select number from public.orders where id = 'd0000000-0000-0000-0000-0000000000b3'), 'IZ-CO-MANUAL1',
  'un number explicito se respeta');

insert into public.warranty_claims (country_code, customer_name, phone, reason)
  values ('CO', 'A', '3000000001', 'Atomizador defectuoso');
select matches((select number from public.warranty_claims order by created_at desc limit 1), '^GAR-CO-[0-9]{4}$',
  'garantia sin number recibe GAR-CO-0000');

select * from finish();
rollback;
