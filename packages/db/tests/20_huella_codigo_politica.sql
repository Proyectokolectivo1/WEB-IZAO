-- Pruebas pgtap · 20261020213954: huella de la solicitud del checkout, índice único de discount_codes.code y
-- pages.kind con la versión vigente de la política de tratamiento de datos.
begin;
set local search_path = public, extensions;
select plan(24);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-0000000000d1', 'Huella Prueba', 'huella-prueba', 'active');
insert into public.product_variants (id, product_id, sku, is_default)
  values ('f0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'HU-A', true);
insert into public.variant_countries (variant_id, country_code, is_active, price, stock)
  values ('f0000000-0000-0000-0000-0000000000d1', 'CO', true, 50000, 50);

-- La única política publicada de CO en esta transacción es la de prueba (versión 4)
update public.pages set status = 'draft' where country_code = 'CO' and kind = 'tratamiento_datos' and status = 'published';
insert into public.pages (id, country_code, slug, title, content_html, version, status, kind)
  values ('e0000000-0000-0000-0000-0000000000d1', 'CO', 'pgtap-datos-20', 'Datos pgtap', '<p>Política</p>', 4, 'published', 'tratamiento_datos');

create function pg_temp.p(p_clave text, p_hash text default null, p_politica text default '4')
returns jsonb language sql as $$
  select jsonb_build_object(
    'order', jsonb_build_object(
      'country_code', 'CO', 'currency_code', 'COP', 'contact_first_name', 'Ana', 'contact_last_name', 'Paz',
      'contact_phone_e164', '+573001112233', 'payment_method', 'wompi', 'subtotal', '50000', 'discount_amount', 0,
      'total_customer', '50000', 'checkout_idempotency_key', p_clave, 'checkout_request_hash', p_hash,
      'terms_accepted_at', now(), 'data_policy_version', p_politica),
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-0000000000d1', 'variant_id', 'f0000000-0000-0000-0000-0000000000d1',
      'sku', 'HU-A', 'name_snapshot', 'Huella Prueba', 'variant_label', '50 ml', 'quantity', 1, 'unit_price', '50000')));
$$;

create temp table r (k text primary key, v jsonb);
insert into r values ('h1', public.crear_pedido_checkout(pg_temp.p('hu-1', repeat('a', 64))));
insert into r values ('h1_igual', public.crear_pedido_checkout(pg_temp.p('hu-1', repeat('a', 64))));
insert into r values ('h1_otra', public.crear_pedido_checkout(pg_temp.p('hu-1', repeat('b', 64))));
insert into r values ('h1_nula', public.crear_pedido_checkout(pg_temp.p('hu-1', null)));
insert into r values ('n1', public.crear_pedido_checkout(pg_temp.p('hu-2', null)));
insert into r values ('n1_con', public.crear_pedido_checkout(pg_temp.p('hu-2', repeat('c', 64))));
insert into r values ('mala', public.crear_pedido_checkout(pg_temp.p('hu-3', 'ABC')));
insert into r values ('vieja', public.crear_pedido_checkout(pg_temp.p('hu-4', repeat('d', 64), '3')));
insert into r values ('sin_version', public.crear_pedido_checkout(pg_temp.p('hu-5', null, null)));

create function pg_temp.plan_codigo() returns text language plpgsql as $$
declare l text; t text := '';
begin
  for l in execute 'explain select id from public.discount_codes where code = ''HUELLAPGTAP''' loop
    t := t || l || ' ';
  end loop;
  return t;
end;
$$;

-- (1) Huella
select has_column('public', 'orders', 'checkout_request_hash', 'orders.checkout_request_hash existe');
select is(r.v->>'estado', 'creado', 'crea el pedido con huella') from r where k = 'h1';
select is((select checkout_request_hash from public.orders where checkout_idempotency_key = 'hu-1'), repeat('a', 64), 'guarda la huella');
select is(r.v->>'repetido', 'true', 'misma clave y misma huella: repetido') from r where k = 'h1_igual';
select is(r.v->>'motivo', 'idempotencia_conflicto', 'misma clave y huella distinta: idempotencia_conflicto') from r where k = 'h1_otra';
select is(r.v->>'repetido', 'true', 'huella nula en la llamada no choca') from r where k = 'h1_nula';
select is(r.v->>'repetido', 'true', 'huella nula guardada no choca') from r where k = 'n1_con';
select is(r.v->>'detalle', 'checkout_request_hash', 'huella mal formada: datos_invalidos') from r where k = 'mala' and r.v->>'motivo' = 'datos_invalidos';
select throws_ok($$ update public.orders set checkout_request_hash = 'xyz' where checkout_idempotency_key = 'hu-2' $$,
                 '23514', null, 'CHECK de la huella en la tabla');
select is(public.pedido_checkout_existente('hu-1', 'CO')->>'repetido', 'true', 'firma de 2 argumentos sigue funcionando');

-- (2) discount_codes.code
select has_index('public', 'discount_codes', 'discount_codes_code_key', array['code'], 'índice sobre discount_codes.code');
insert into public.discount_codes (code, country_code, type, value) values ('HUELLAPGTAP', 'CO', 'percent', 5);
select throws_ok($$ insert into public.discount_codes (code, country_code, type, value) values ('HUELLAPGTAP', 'CO', 'fixed', 1000) $$,
                 '23505', null, 'código duplicado rechazado');
set local enable_seqscan = off;
select ok(pg_temp.plan_codigo() ~ 'discount_codes_code_key', '.eq(code) usa discount_codes_code_key');
reset enable_seqscan;

-- (3) pages.kind y política vigente
select has_column('public', 'pages', 'kind', 'pages.kind existe');
select throws_ok($$ update public.pages set kind = 'otra' where id = 'e0000000-0000-0000-0000-0000000000d1' $$,
                 '23514', null, 'kind fuera de la lista rechazado');
select throws_ok($$ insert into public.pages (country_code, slug, title, content_html, version, status, kind)
                    values ('CO', 'pgtap-datos-20b', 'Otra', '<p>x</p>', 5, 'published', 'tratamiento_datos') $$,
                 '23505', null, 'solo una política de datos publicada por país');
select lives_ok($$ insert into public.pages (country_code, slug, title, content_html, version, status, kind)
                   values ('CO', 'pgtap-datos-20c', 'Borrador', '<p>x</p>', 5, 'draft', 'tratamiento_datos') $$,
                'varios borradores del mismo tipo permitidos');
select is((select count(*)::int from public.pages where slug = 'tratamiento-de-datos' and kind <> 'tratamiento_datos'), 0,
          'seed: tratamiento-de-datos marcada como tratamiento_datos');
select is(public.politica_datos_vigente('CO'), '4', 'politica_datos_vigente = versión de la publicada');
select is((select data_policy_version from public.orders where checkout_idempotency_key = 'hu-1'), '4', 'el pedido guarda la versión vigente');
select is(r.v->>'motivo' || '/' || (r.v->>'version_vigente'), 'politica_datos_desactualizada/4', 'versión vieja rechazada con la vigente')
  from r where k = 'vieja';
select is((select count(*)::int from public.orders where checkout_idempotency_key in ('hu-4', 'hu-5')), 0, 'rechazo de política no escribe')
  from r where k = 'sin_version' and r.v->>'motivo' = 'politica_datos_desactualizada';
update public.pages set status = 'draft' where id = 'e0000000-0000-0000-0000-0000000000d1';
select is(public.crear_pedido_checkout(pg_temp.p('hu-6'))->>'motivo', 'sin_politica_datos', 'sin política publicada: sin_politica_datos');

-- Privilegios
select ok(not has_function_privilege('anon', 'public.politica_datos_vigente(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.pedido_checkout_existente(text, text, text)', 'execute')
          and has_function_privilege('service_role', 'public.politica_datos_vigente(text)', 'execute'),
          'funciones nuevas solo para service_role');

select * from finish();
rollback;
