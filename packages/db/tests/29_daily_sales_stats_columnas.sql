-- Pruebas pgtap · 20261025033707: columnas de daily_sales_stats que escribe FilaVentasDiarias (@izao/core/metrics).
begin;
set local search_path = public, extensions;
select plan(25);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;

select has_column('public', 'daily_sales_stats', 'orders_abandoned', 'existe orders_abandoned');
select col_type_is('public', 'daily_sales_stats', 'orders_abandoned', 'integer', 'orders_abandoned es integer');
select col_not_null('public', 'daily_sales_stats', 'orders_abandoned', 'orders_abandoned es not null');
select col_default_is('public', 'daily_sales_stats', 'orders_abandoned', '0', 'orders_abandoned default 0');

select has_column('public', 'daily_sales_stats', 'confirmed_revenue', 'existe confirmed_revenue');
select col_type_is('public', 'daily_sales_stats', 'confirmed_revenue', 'bigint', 'confirmed_revenue es bigint');
select col_not_null('public', 'daily_sales_stats', 'confirmed_revenue', 'confirmed_revenue es not null');
select col_default_is('public', 'daily_sales_stats', 'confirmed_revenue', '0', 'confirmed_revenue default 0');

select has_column('public', 'daily_sales_stats', 'carrier_platform_fees', 'existe carrier_platform_fees');
select col_type_is('public', 'daily_sales_stats', 'carrier_platform_fees', 'bigint', 'carrier_platform_fees es bigint');
select col_not_null('public', 'daily_sales_stats', 'carrier_platform_fees', 'carrier_platform_fees es not null');
select col_default_is('public', 'daily_sales_stats', 'carrier_platform_fees', '0', 'carrier_platform_fees default 0');

select has_column('public', 'daily_sales_stats', 'shipping_estimated_count', 'existe shipping_estimated_count');
select col_type_is('public', 'daily_sales_stats', 'shipping_estimated_count', 'integer', 'shipping_estimated_count es integer');
select col_not_null('public', 'daily_sales_stats', 'shipping_estimated_count', 'shipping_estimated_count es not null');
select col_default_is('public', 'daily_sales_stats', 'shipping_estimated_count', '0', 'shipping_estimated_count default 0');

-- Una fila nueva sin las columnas queda en 0; montos grandes caben en bigint.
select lives_ok($$ insert into public.daily_sales_stats (date, country_code, payment_method, currency_code)
                   values ('2026-10-01', 'CO', 'cod', 'COP') $$, 'insert sin las columnas nuevas');
select is((select (orders_abandoned, confirmed_revenue, carrier_platform_fees, shipping_estimated_count)::text
             from public.daily_sales_stats where date = '2026-10-01' and country_code = 'CO' and payment_method = 'cod'),
          '(0,0,0,0)', 'las cuatro columnas nacen en 0');
select lives_ok($$ update public.daily_sales_stats set confirmed_revenue = 9000000000000, carrier_platform_fees = 3000000000000
                   where date = '2026-10-01' and country_code = 'CO' and payment_method = 'cod' $$, 'montos bigint grandes');

-- No negativos.
select throws_ok($$ update public.daily_sales_stats set orders_abandoned = -1 where date = '2026-10-01' $$,
                 '23514', null, 'orders_abandoned negativo: viola el check');
select throws_ok($$ update public.daily_sales_stats set confirmed_revenue = -1 where date = '2026-10-01' $$,
                 '23514', null, 'confirmed_revenue negativo: viola el check');
select throws_ok($$ update public.daily_sales_stats set carrier_platform_fees = -1 where date = '2026-10-01' $$,
                 '23514', null, 'carrier_platform_fees negativo: viola el check');
select throws_ok($$ update public.daily_sales_stats set shipping_estimated_count = -1 where date = '2026-10-01' $$,
                 '23514', null, 'shipping_estimated_count negativo: viola el check');

-- RLS intacto y sin acceso para anon/authenticated.
select ok((select relrowsecurity from pg_class where oid = 'public.daily_sales_stats'::regclass)
          and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_sales_stats'),
          'RLS activo y sin políticas en daily_sales_stats');
select ok(not has_table_privilege('anon', 'public.daily_sales_stats', 'select')
          and not has_table_privilege('authenticated', 'public.daily_sales_stats', 'select')
          and not has_column_privilege('anon', 'public.daily_sales_stats', 'confirmed_revenue', 'update')
          and not has_column_privilege('authenticated', 'public.daily_sales_stats', 'confirmed_revenue', 'update'),
          'anon/authenticated no leen ni editan daily_sales_stats');

select * from finish();
rollback;
