-- Pruebas pgtap · orders.marketing_consent (20261124120000): default false, crear_pedido_checkout lo guarda
-- si viene true y lo deja false si no viene; anon y authenticated no pueden escribirlo ni leerlo.
begin;
set local search_path = public, extensions;
select plan(10);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-0000000004c1', 'Consentimiento Prueba', 'consentimiento-prueba-40', 'active');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('f0000000-0000-0000-0000-0000000004c1', 'a0000000-0000-0000-0000-0000000004c1', 'MC-40', true);
insert into public.variant_countries (variant_id, country_code, is_active, price, stock) values
  ('f0000000-0000-0000-0000-0000000004c1', 'CO', true, 50000, 10);
update public.pages set status = 'draft' where country_code = 'CO' and kind = 'tratamiento_datos' and status = 'published';
insert into public.pages (country_code, slug, title, content_html, version, status, kind)
  values ('CO', 'pgtap-datos-40', 'Datos pgtap', '<p>Política</p>', 9, 'published', 'tratamiento_datos');

-- Payload mínimo válido (1 x 50000, wompi); p_extra se mezcla en order
create function pg_temp.p(p_clave text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'order', jsonb_build_object(
      'country_code', 'CO', 'currency_code', 'COP', 'contact_first_name', 'Ana', 'contact_last_name', 'Paz',
      'contact_phone_e164', '+573001112233', 'contact_email', 'ana@test.local', 'document_type', 'CC', 'document_number', '1020304050',
      'payment_method', 'wompi', 'subtotal', '50000', 'discount_amount', 0, 'total_customer', '50000',
      'product_cost_total', '20000', 'checkout_idempotency_key', p_clave, 'terms_accepted_at', now(),
      'data_policy_version', '9') || p_extra,
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-0000000004c1', 'variant_id', 'f0000000-0000-0000-0000-0000000004c1',
      'sku', 'MC-40', 'name_snapshot', 'Consentimiento Prueba', 'variant_label', '50 ml', 'quantity', 1,
      'unit_price', '50000', 'unit_cost', 20000, 'line_discount', 0)));
$$;

-- 1. Esquema
select col_type_is('public', 'orders', 'marketing_consent', 'boolean', 'marketing_consent es boolean');
select col_not_null('public', 'orders', 'marketing_consent', 'marketing_consent es not null');
select col_default_is('public', 'orders', 'marketing_consent', 'false', 'default false');

-- 2. Checkout
create temp table r (k text primary key, v jsonb);
insert into r values
  ('si', public.crear_pedido_checkout(pg_temp.p('mc-pgtap-si', '{"marketing_consent": true}'))),
  ('sin', public.crear_pedido_checkout(pg_temp.p('mc-pgtap-sin'))),
  ('no', public.crear_pedido_checkout(pg_temp.p('mc-pgtap-no', '{"marketing_consent": false}')));

select is((select count(*)::int from r where v->>'ok' = 'true'), 3, 'los tres pedidos se crean');
select is((select marketing_consent from public.orders where checkout_idempotency_key = 'mc-pgtap-si'), true,
  'con marketing_consent true lo guarda');
select is((select marketing_consent from public.orders where checkout_idempotency_key = 'mc-pgtap-sin'), false,
  'sin el dato queda false');
select is((select marketing_consent from public.orders where checkout_idempotency_key = 'mc-pgtap-no'), false,
  'con false queda false');
select is(public.crear_pedido_checkout(pg_temp.p('mc-pgtap-malo', '{"marketing_consent": "quizas"}'))->>'motivo', 'datos_invalidos',
  'valor no booleano: datos_invalidos sin pedido');

-- 3. Privilegios de columna: ni anon ni authenticated la escriben ni la leen
select is((select count(*)::int from (values ('anon'), ('authenticated')) g(rol), (values ('INSERT'), ('UPDATE')) p(priv)
             where has_column_privilege(g.rol, 'public.orders', 'marketing_consent', p.priv)), 0,
  'anon y authenticated no escriben marketing_consent');
select is((select count(*)::int from (values ('anon'), ('authenticated')) g(rol)
             where has_column_privilege(g.rol, 'public.orders', 'marketing_consent', 'SELECT')), 0,
  'anon y authenticated no leen marketing_consent');

select * from finish();
rollback;
