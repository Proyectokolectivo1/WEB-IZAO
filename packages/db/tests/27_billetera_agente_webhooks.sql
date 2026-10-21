-- Pruebas pgtap · 20261021015339: billetera en country_settings, print_agents.remote_config e integration_webhooks.
begin;
set local search_path = public, extensions;
select plan(28);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;

-- 1. country_settings.carrier_wallet_*
select col_type_is('public', 'country_settings', 'carrier_wallet_low_balance', 'bigint', 'umbral bigint');
select col_type_is('public', 'country_settings', 'carrier_wallet_balance', 'bigint', 'saldo bigint');
select col_type_is('public', 'country_settings', 'carrier_wallet_balance_at', 'timestamp with time zone', 'fecha del saldo timestamptz');
select col_type_is('public', 'country_settings', 'carrier_wallet_low_alert_at', 'timestamp with time zone', 'alerta timestamptz');
select col_is_null('public', 'country_settings', 'carrier_wallet_low_balance', 'umbral admite null (sin alerta)');
select throws_ok($$ update public.country_settings set carrier_wallet_low_balance = -1 where country_code = 'CO' $$,
                 '23514', null, 'umbral negativo: viola el check');
select lives_ok($$ update public.country_settings set carrier_wallet_low_balance = 100000, carrier_wallet_balance = -5000,
                   carrier_wallet_balance_at = now(), carrier_wallet_low_alert_at = now() where country_code = 'CO' $$,
                'saldo (puede ser negativo), fecha y alerta se guardan');
select lives_ok($$ update public.country_settings set carrier_wallet_low_alert_at = null where country_code = 'CO' $$,
                'la alerta se rearma con null');
select ok(not has_column_privilege('anon', 'public.country_settings', 'carrier_wallet_balance', 'select')
          and not has_column_privilege('authenticated', 'public.country_settings', 'carrier_wallet_balance', 'select'),
          'anon/authenticated no leen el saldo');
select ok(not has_column_privilege('anon', 'public.country_settings', 'carrier_wallet_low_balance', 'update')
          and not has_column_privilege('authenticated', 'public.country_settings', 'carrier_wallet_low_balance', 'update'),
          'anon/authenticated no editan el umbral');

-- 2. print_agents.remote_config
select col_type_is('public', 'print_agents', 'remote_config', 'jsonb', 'remote_config jsonb');
select col_not_null('public', 'print_agents', 'remote_config', 'remote_config not null');
select col_default_is('public', 'print_agents', 'remote_config', '{}', 'default {}');
insert into public.print_agents (name, token_hash) values ('PC prueba', 'hash-prueba-27');
select is((select remote_config from public.print_agents where token_hash = 'hash-prueba-27'), '{}'::jsonb, 'agente nuevo con {}');
select throws_ok($$ update public.print_agents set remote_config = '[]'::jsonb where token_hash = 'hash-prueba-27' $$,
                 '23514', null, 'remote_config debe ser objeto');
select lives_ok($$ update public.print_agents set remote_config = '{"intervals":{"claim_seconds":20}}' where token_hash = 'hash-prueba-27' $$,
                'remote_config objeto se guarda');
select ok(not has_column_privilege('anon', 'public.print_agents', 'remote_config', 'select')
          and not has_column_privilege('authenticated', 'public.print_agents', 'remote_config', 'select'),
          'anon/authenticated no leen remote_config');

-- 3. integration_webhooks
select has_table('public', 'integration_webhooks', 'existe integration_webhooks');
select ok((select relrowsecurity from pg_class where oid = 'public.integration_webhooks'::regclass), 'RLS activo');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'integration_webhooks'), 0,
          'sin políticas: denegado por defecto');
select col_type_is('public', 'integration_webhooks', 'external_id', 'bigint', 'external_id bigint');
select lives_ok($$ insert into public.integration_webhooks (provider, country_code, environment, event_id, event_name, external_id)
                   values ('mastershop', 'CO', 'production', 16, 'Cambio de estado del pedido', 6001),
                          ('mastershop', 'CO', 'production', 17, 'Cambio de estado de la transportadora', 6002) $$,
                'se guardan los idProductWebhook de 16 y 17');
select throws_ok($$ insert into public.integration_webhooks (provider, country_code, environment, event_id, event_name, external_id)
                    values ('mastershop', 'CO', 'production', 16, 'Duplicado', 6003) $$,
                 '23505', null, 'un evento por proveedor/país/entorno');
select throws_ok($$ insert into public.integration_webhooks (provider, country_code, environment, event_id, event_name, external_id)
                    values ('mastershop', 'CO', 'production', 18, 'Otro', 6001) $$,
                 '23505', null, 'external_id único por proveedor/entorno');
select throws_ok($$ insert into public.integration_webhooks (provider, country_code, environment, event_id, event_name, external_id)
                    values ('mastershop', 'CO', 'staging', 18, 'Otro', 7001) $$,
                 '23514', null, 'entorno inválido');
select throws_ok($$ insert into public.integration_webhooks (provider, country_code, environment, event_id, event_name, external_id)
                    values ('mastershop', 'CO', 'production', 18, 'Otro', 0) $$,
                 '23514', null, 'external_id debe ser positivo');
select ok(not has_table_privilege('anon', 'public.integration_webhooks', 'select')
          and not has_table_privilege('authenticated', 'public.integration_webhooks', 'select'),
          'anon/authenticated no leen integration_webhooks');
select ok(not has_table_privilege('anon', 'public.integration_webhooks', 'insert,update,delete')
          and not has_table_privilege('authenticated', 'public.integration_webhooks', 'insert,update,delete'),
          'anon/authenticated no escriben integration_webhooks');

select * from finish();
rollback;
