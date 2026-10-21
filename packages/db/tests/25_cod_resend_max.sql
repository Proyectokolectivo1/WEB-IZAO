-- Pruebas pgtap · 20261021013019: country_settings.cod_resend_max (tope de "Reenviar cobro").
begin;
set local search_path = public, extensions;
select plan(9);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;

select has_column('public', 'country_settings', 'cod_resend_max', 'existe cod_resend_max');
select col_type_is('public', 'country_settings', 'cod_resend_max', 'integer', 'cod_resend_max es integer');
select col_not_null('public', 'country_settings', 'cod_resend_max', 'cod_resend_max es not null');
select col_default_is('public', 'country_settings', 'cod_resend_max', '2', 'default 2');

select throws_ok($$ update public.country_settings set cod_resend_max = -1 where country_code = 'CO' $$,
                 '23514', null, 'negativo: viola el check');
select lives_ok($$ update public.country_settings set cod_resend_max = 0 where country_code = 'CO' $$,
                '0 es válido (no se permite reenviar)');
select throws_ok($$ update public.country_settings set cod_resend_max = null where country_code = 'CO' $$,
                 '23502', null, 'null: viola not null');

-- RLS sin políticas: anon y authenticated no leen ni editan country_settings.
select ok(not has_column_privilege('anon', 'public.country_settings', 'cod_resend_max', 'select')
          and not has_column_privilege('authenticated', 'public.country_settings', 'cod_resend_max', 'select'),
          'anon/authenticated no leen cod_resend_max');
select ok(not has_column_privilege('anon', 'public.country_settings', 'cod_resend_max', 'update')
          and not has_column_privilege('authenticated', 'public.country_settings', 'cod_resend_max', 'update'),
          'anon/authenticated no editan cod_resend_max');

select * from finish();
rollback;
