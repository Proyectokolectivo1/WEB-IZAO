-- Pruebas pgtap · 20261021062843: única credencial activa por (provider, country_code) y activar_credencial_integracion.
begin;
set local search_path = public, extensions;
select plan(15);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;

-- pgtap_prov/CO: sandbox activa, production inactiva. pgtap_glob (global, country null): sandbox activa, production inactiva.
insert into public.integration_credentials (id, provider, country_code, environment, data_encrypted, iv, is_active) values
  ('c0000000-0000-0000-0000-0000000028a1', 'pgtap_prov', 'CO', 'sandbox',    '\x00', '\x00', true),
  ('c0000000-0000-0000-0000-0000000028a2', 'pgtap_prov', 'CO', 'production', '\x00', '\x00', false),
  ('c0000000-0000-0000-0000-0000000028b1', 'pgtap_glob', null, 'sandbox',    '\x00', '\x00', true),
  ('c0000000-0000-0000-0000-0000000028b2', 'pgtap_glob', null, 'production', '\x00', '\x00', false),
  ('c0000000-0000-0000-0000-0000000028c1', 'pgtap_otro', 'CO', 'production', '\x00', '\x00', true);

create temp table r (k text primary key, v jsonb);

select ok(not has_function_privilege('anon', 'public.activar_credencial_integracion(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.activar_credencial_integracion(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.activar_credencial_integracion(uuid)', 'execute'),
          'solo service_role ejecuta activar_credencial_integracion');

-- El índice impide dos activas del mismo proveedor y país (también globales).
select throws_ok($$update public.integration_credentials set is_active = true where id = 'c0000000-0000-0000-0000-0000000028a2'$$,
                 '23505', null, 'dos activas del mismo proveedor y país: 23505');
select throws_ok($$update public.integration_credentials set is_active = true where id = 'c0000000-0000-0000-0000-0000000028b2'$$,
                 '23505', null, 'dos activas globales (country null): 23505');
select lives_ok($$insert into public.integration_credentials (provider, country_code, environment, data_encrypted, iv, is_active)
                  values ('pgtap_prov', 'CO', 'sandbox', '\x00', '\x00', false)
                  on conflict on constraint integration_credentials_provider_country_env_key do nothing$$,
                'inactivas no chocan con el índice parcial');

-- Activar production de pgtap_prov/CO: apaga sandbox.
insert into r values ('a2', public.activar_credencial_integracion('c0000000-0000-0000-0000-0000000028a2'));
select is(r.v->>'estado', 'activada', 'activar otra: activada') from r where k = 'a2';
select is(r.v->>'anterior_id', 'c0000000-0000-0000-0000-0000000028a1', 'informa la anterior') from r where k = 'a2';
select is(r.v->>'anterior_environment' || '>' || (r.v->>'environment'), 'sandbox>production', 'informa ambos entornos') from r where k = 'a2';
select is((select string_agg(environment, ',') from public.integration_credentials where provider = 'pgtap_prov' and is_active),
          'production', 'queda una sola activa: production');
select ok((select is_active from public.integration_credentials where id = 'c0000000-0000-0000-0000-0000000028c1'),
          'no toca otros proveedores');

-- Repetir: ya_activa, sin cambios.
insert into r values ('a2b', public.activar_credencial_integracion('c0000000-0000-0000-0000-0000000028a2'));
select is(r.v->>'estado', 'ya_activa', 'repetir: ya_activa') from r where k = 'a2b';

-- Global (country null): agrupa por null.
insert into r values ('b2', public.activar_credencial_integracion('c0000000-0000-0000-0000-0000000028b2'));
select is(r.v->>'estado' || '/' || coalesce(r.v->>'country_code', 'null'), 'activada/null', 'global: activada con country null')
  from r where k = 'b2';
select is((select string_agg(environment, ',') from public.integration_credentials where provider = 'pgtap_glob' and is_active),
          'production', 'global: una sola activa');

-- Sin activa previa: anterior_* null.
update public.integration_credentials set is_active = false where id = 'c0000000-0000-0000-0000-0000000028c1';
insert into r values ('c1', public.activar_credencial_integracion('c0000000-0000-0000-0000-0000000028c1'));
select ok(r.v->>'estado' = 'activada' and r.v->'anterior_id' = 'null'::jsonb, 'sin activa previa: anterior_id null')
  from r where k = 'c1';

select is(public.activar_credencial_integracion('c0000000-0000-0000-0000-00000000ffff')->>'motivo', 'no_existe', 'id inexistente: no_existe');
select is(public.activar_credencial_integracion(null)->>'motivo', 'datos_invalidos', 'id nulo: datos_invalidos');

select * from finish();
rollback;
