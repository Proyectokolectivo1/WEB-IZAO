-- Pruebas pgtap · 20261128120000 (D-062): country_settings.auto_print_max_shipping_rate (umbral de flete para la
-- impresión automática de la guía) y una sola retención `impresion_manual_requerida` por pedido.
-- El valor CO = 25000 lo deja el `update` de la migración (y el seed); aquí no se asume si la fila CO existía antes.
begin;
set local search_path = public, extensions;
select plan(14);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;

select has_column('public', 'country_settings', 'auto_print_max_shipping_rate', 'existe auto_print_max_shipping_rate');
select col_type_is('public', 'country_settings', 'auto_print_max_shipping_rate', 'bigint', 'es bigint (unidad menor)');
select col_is_null('public', 'country_settings', 'auto_print_max_shipping_rate', 'admite null (sin límite)');
select col_hasnt_default('public', 'country_settings', 'auto_print_max_shipping_rate', 'sin default: un país nuevo queda sin límite');

select throws_ok($$ update public.country_settings set auto_print_max_shipping_rate = -1 where country_code = 'CO' $$,
                 '23514', null, 'negativo: viola el check');
select lives_ok($$ update public.country_settings set auto_print_max_shipping_rate = 0 where country_code = 'CO' $$,
                '0 es válido (todo flete mayor a 0 va a impresión manual)');
select lives_ok($$ update public.country_settings set auto_print_max_shipping_rate = null where country_code = 'CO' $$,
                'null es válido (sin límite)');
select lives_ok($$ update public.country_settings set auto_print_max_shipping_rate = 25000 where country_code = 'CO' $$,
                '25000 es válido');

-- RLS sin políticas: anon y authenticated no leen ni editan el umbral.
select ok(not has_column_privilege('anon', 'public.country_settings', 'auto_print_max_shipping_rate', 'select')
          and not has_column_privilege('authenticated', 'public.country_settings', 'auto_print_max_shipping_rate', 'select'),
          'anon/authenticated no leen el umbral');
select ok(not has_column_privilege('anon', 'public.country_settings', 'auto_print_max_shipping_rate', 'update')
          and not has_column_privilege('authenticated', 'public.country_settings', 'auto_print_max_shipping_rate', 'update'),
          'anon/authenticated no editan el umbral');

-- Una sola retención por pedido.
insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
                           payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount, paid_at) values
  ('c4700000-0000-0000-0000-000000000001', 'PGTAP42-A', 'CO', 'COP', 'C', 'A', '+573005552001', 'wompi', 'en_preparacion', 169900, 169900, 0, 0, now()),
  ('c4700000-0000-0000-0000-000000000002', 'PGTAP42-B', 'CO', 'COP', 'C', 'B', '+573005552002', 'wompi', 'en_preparacion', 169900, 169900, 0, 0, now());

select has_index('public', 'order_events', 'order_events_impresion_manual_unica_key', 'existe el índice de retención única');
select lives_ok($$ insert into public.order_events (order_id, type, actor, payload) values
                   ('c4700000-0000-0000-0000-000000000001', 'transportadora', 'system',
                    '{"accion":"impresion_manual_requerida","flete":"30000","umbral":"25000","motivo":"flete_sobre_umbral"}') $$,
                'primera retención del pedido A');
select throws_ok($$ insert into public.order_events (order_id, type, actor, payload) values
                    ('c4700000-0000-0000-0000-000000000001', 'transportadora', 'webhook:mastershop',
                     '{"accion":"impresion_manual_requerida","flete":"31000","umbral":"25000","motivo":"flete_sobre_umbral"}') $$,
                 '23505', null, 'segunda retención del mismo pedido: 23505');
select lives_ok($$ insert into public.order_events (order_id, type, actor, payload) values
                   ('c4700000-0000-0000-0000-000000000001', 'transportadora', 'system', '{"accion":"etiqueta_guardada"}'),
                   ('c4700000-0000-0000-0000-000000000001', 'transportadora', 'system', '{"accion":"etiqueta_guardada"}'),
                   ('c4700000-0000-0000-0000-000000000002', 'transportadora', 'system',
                    '{"accion":"impresion_manual_requerida","flete":"30000","umbral":"25000","motivo":"flete_sobre_umbral"}') $$,
                'otras acciones se repiten y otro pedido tiene su propia retención');

select * from finish();
rollback;
