-- Pruebas pgtap · 20261021013134: una etiqueta automática (no cancelada) por envío en print_jobs.
begin;
set local search_path = public, extensions;
select plan(8);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer) values
  ('d0000000-0000-0000-0000-0000000026a1', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pagado', 90000, 90000),
  ('d0000000-0000-0000-0000-0000000026a2', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pagado', 90000, 90000);
insert into public.shipments (id, order_id, external_order_id) values
  ('e0000000-0000-0000-0000-0000000026a1', 'd0000000-0000-0000-0000-0000000026a1', 'pgtap-26-a'),
  ('e0000000-0000-0000-0000-0000000026a2', 'd0000000-0000-0000-0000-0000000026a2', 'pgtap-26-b');

select has_index('public', 'print_jobs', 'print_jobs_etiqueta_auto_unica_key', 'existe el índice único parcial');

select lives_ok($$ insert into public.print_jobs (order_id, shipment_id, type, requested_by)
  values ('d0000000-0000-0000-0000-0000000026a1', 'e0000000-0000-0000-0000-0000000026a1', 'label', 'auto') $$,
  'primera etiqueta automática');
select throws_ok($$ insert into public.print_jobs (order_id, shipment_id, type, requested_by)
  values ('d0000000-0000-0000-0000-0000000026a1', 'e0000000-0000-0000-0000-0000000026a1', 'label', 'auto') $$,
  '23505', null, 'segunda etiqueta automática del mismo envío: 23505');
select lives_ok($$ insert into public.print_jobs (order_id, shipment_id, type, requested_by)
  values ('d0000000-0000-0000-0000-0000000026a1', 'e0000000-0000-0000-0000-0000000026a1', 'label', 'admin:reimprimir') $$,
  'reimpresión manual permitida');
select lives_ok($$ insert into public.print_jobs (order_id, shipment_id, type, requested_by)
  values ('d0000000-0000-0000-0000-0000000026a1', 'e0000000-0000-0000-0000-0000000026a1', 'packing_list', 'auto') $$,
  'otro tipo (packing_list) no cuenta');
select lives_ok($$ insert into public.print_jobs (order_id, shipment_id, type, requested_by)
  values ('d0000000-0000-0000-0000-0000000026a2', 'e0000000-0000-0000-0000-0000000026a2', 'label', 'auto') $$,
  'otro envío: permitido');

update public.print_jobs set status = 'cancelled'
  where shipment_id = 'e0000000-0000-0000-0000-0000000026a1' and type = 'label' and requested_by = 'auto';
select lives_ok($$ insert into public.print_jobs (order_id, shipment_id, type, requested_by)
  values ('d0000000-0000-0000-0000-0000000026a1', 'e0000000-0000-0000-0000-0000000026a1', 'label', 'auto') $$,
  'tras cancelar la anterior: permitida');

select ok(not has_table_privilege('anon', 'public.print_jobs', 'insert')
          and not has_table_privilege('authenticated', 'public.print_jobs', 'insert'),
          'anon/authenticated no insertan en print_jobs');

select * from finish();
rollback;
