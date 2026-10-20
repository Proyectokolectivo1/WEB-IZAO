-- Pruebas pgtap · 20261020221412: pay_link_click(token) atómica y whatsapp_messages único por envío.
begin;
set local search_path = public, extensions;
select plan(16);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-0000000000f1', 'Clic Prueba', 'clic-prueba', 'active');
insert into public.product_variants (id, product_id, sku, is_default)
  values ('f0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'CL-A', true);
insert into public.variant_countries (variant_id, country_code, is_active, price, stock)
  values ('f0000000-0000-0000-0000-0000000000f1', 'CO', true, 50000, 50);
update public.pages set status = 'draft' where country_code = 'CO' and kind = 'tratamiento_datos' and status = 'published';
insert into public.pages (country_code, slug, title, content_html, version, status, kind)
  values ('CO', 'pgtap-datos-23', 'Datos pgtap', '<p>Política</p>', 2, 'published', 'tratamiento_datos');

create temp table o (id uuid);
insert into o select (public.crear_pedido_checkout(jsonb_build_object(
  'order', jsonb_build_object(
    'country_code', 'CO', 'currency_code', 'COP', 'contact_first_name', 'Ana', 'contact_last_name', 'Paz',
    'contact_phone_e164', '+573001112233', 'payment_method', 'cod', 'subtotal', '50000', 'discount_amount', 0,
    'total_customer', '50000', 'cod_deposit_amount', '20000', 'cod_collect_amount', '30000',
    'checkout_idempotency_key', 'cl-pgtap-1', 'terms_accepted_at', now(), 'data_policy_version', '2'),
  'items', jsonb_build_array(jsonb_build_object(
    'product_id', 'a0000000-0000-0000-0000-0000000000f1', 'variant_id', 'f0000000-0000-0000-0000-0000000000f1',
    'sku', 'CL-A', 'name_snapshot', 'Clic Prueba', 'variant_label', '50 ml', 'quantity', 1, 'unit_price', '50000'))))
  ->'order'->>'id')::uuid;

insert into public.pay_links (token, order_id, target_url, expires_at)
  select 'pgtapVigente01', id, 'https://checkout.wompi.co/l/pgtap', now() + interval '1 hour' from o
  union all
  select 'pgtapVencido01', id, 'https://checkout.wompi.co/l/pgtap2', now() - interval '1 minute' from o;

create temp table r (k text primary key, v jsonb);

-- (a) pay_link_click
select ok(not has_function_privilege('anon', 'public.pay_link_click(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.pay_link_click(text)', 'execute')
          and has_function_privilege('service_role', 'public.pay_link_click(text)', 'execute'),
          'solo service_role ejecuta pay_link_click');

insert into r values ('v1', public.pay_link_click('pgtapVigente01'));
insert into r values ('v2', public.pay_link_click('pgtapVigente01'));
select is(r.v->>'estado', 'vigente', 'link vigente sin pagar: vigente') from r where k = 'v1';
select is(r.v->>'target_url', 'https://checkout.wompi.co/l/pgtap', 'vigente: devuelve target_url') from r where k = 'v1';
select is((r.v->>'clicks')::int, 2, 'cada llamada suma un clic') from r where k = 'v2';
select is((select clicks from public.pay_links where token = 'pgtapVigente01'), 2, 'clicks persistido');
select ok(r.v ? 'order_number' and (r.v->>'order_id')::uuid = (select id from o), 'devuelve order_id y order_number') from r where k = 'v1';

insert into r values ('x', public.pay_link_click('pgtapVencido01'));
select is(r.v->>'estado', 'vencido', 'expires_at pasado: vencido') from r where k = 'x';
select ok(not (r.v ? 'target_url'), 'vencido: sin target_url') from r where k = 'x';
select is((select clicks from public.pay_links where token = 'pgtapVencido01'), 1, 'cuenta clics de links vencidos');

insert into public.payments (order_id, provider, purpose, amount, currency_code, status)
  select id, 'wompi', 'cod_deposit', 20000, 'COP', 'approved' from o;
insert into r values ('p', public.pay_link_click('pgtapVigente01'));
select is(r.v->>'estado', 'pagado', 'abono aprobado: pagado') from r where k = 'p';
select ok(not (r.v ? 'target_url'), 'pagado: sin target_url') from r where k = 'p';

select is(public.pay_link_click('noexiste01')->>'motivo', 'no_existe', 'token inexistente: no_existe');
select is(public.pay_link_click('a b')->>'motivo', 'datos_invalidos', 'token mal formado: datos_invalidos');

-- (b) whatsapp_messages único por (order_id, template_id, scheduled_for)
insert into public.whatsapp_templates (id, key, country_code, meta_template_name, body_text)
  values ('b0000000-0000-0000-0000-0000000000f1', 'pgtap_clic', 'CO', 'pgtap_clic', 'Hola {{1}}');
insert into public.whatsapp_messages (order_id, template_id, to_e164, scheduled_for)
  select id, 'b0000000-0000-0000-0000-0000000000f1', '+573001112233', '2026-10-21T15:00:00Z' from o;
select throws_ok($$ insert into public.whatsapp_messages (order_id, template_id, to_e164, scheduled_for)
                    select id, 'b0000000-0000-0000-0000-0000000000f1', '+573001112233', '2026-10-21T15:00:00Z' from o $$,
                 '23505', null, 'mismo pedido, plantilla y hora: rechazado');
select lives_ok($$ insert into public.whatsapp_messages (order_id, template_id, to_e164, scheduled_for)
                   select id, 'b0000000-0000-0000-0000-0000000000f1', '+573001112233', '2026-10-21T18:00:00Z' from o $$,
                'otra hora programada: permitido');
select lives_ok($$ insert into public.whatsapp_messages (order_id, template_id, to_e164)
                   select id, 'b0000000-0000-0000-0000-0000000000f1'::uuid, '+573001112233' from o
                   union all
                   select id, 'b0000000-0000-0000-0000-0000000000f1', '+573001112233' from o $$,
                'sin scheduled_for no chocan');

select * from finish();
rollback;
