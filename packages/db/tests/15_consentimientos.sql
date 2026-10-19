-- Pruebas pgtap · T1.12: consentimientos del checkout (§10.1 paso 6) y copia del código de descuento en el pedido.
begin;
set local search_path = public, extensions;
select plan(8);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.discount_codes (id, code, country_code, type, value) values ('c0000000-0000-0000-0000-0000000000c1', 'COPIAPGTAP', 'CO', 'percent', 10);
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer, discount_code_id, discount_amount) values
  ('d0000000-0000-0000-0000-0000000000c1', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 900, 'c0000000-0000-0000-0000-0000000000c1', 100),
  ('d0000000-0000-0000-0000-0000000000c2', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 1000, null, 0);

select has_column('public', 'orders', 'terms_accepted_at', 'orders.terms_accepted_at');
select has_column('public', 'orders', 'data_policy_version', 'orders.data_policy_version');
select has_column('public', 'orders', 'whatsapp_opt_in', 'orders.whatsapp_opt_in');
select is((select whatsapp_opt_in from public.orders where id = 'd0000000-0000-0000-0000-0000000000c2'), false, 'whatsapp_opt_in es false por defecto');
select is((select discount_code_text from public.orders where id = 'd0000000-0000-0000-0000-0000000000c1'), 'COPIAPGTAP', 'el pedido copia el texto del codigo');
select is((select discount_code_text from public.orders where id = 'd0000000-0000-0000-0000-0000000000c2'), null, 'sin codigo no hay copia');
delete from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000c1';
select is((select discount_code_text from public.orders where id = 'd0000000-0000-0000-0000-0000000000c1'), 'COPIAPGTAP', 'al borrar el codigo el pedido conserva el texto');
select is((select count(*)::int from pg_attribute a where a.attrelid = 'public.orders'::regclass and a.attname in ('terms_accepted_at','data_policy_version','whatsapp_opt_in','discount_code_text')
            and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')), 0, 'el cliente no lee las columnas nuevas directamente');

select * from finish();
rollback;
