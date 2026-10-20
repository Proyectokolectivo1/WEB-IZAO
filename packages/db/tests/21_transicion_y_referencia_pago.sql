-- Pruebas pgtap · 20261020214637: payments (provider, provider_reference) único y aplicar_transicion_pedido atómica.
begin;
set local search_path = public, extensions;
select plan(18);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-0000000000e1', 'Transicion Prueba', 'transicion-prueba', 'active');
insert into public.product_variants (id, product_id, sku, is_default)
  values ('f0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'TR-A', true);
insert into public.variant_countries (variant_id, country_code, is_active, price, stock)
  values ('f0000000-0000-0000-0000-0000000000e1', 'CO', true, 50000, 50);
update public.pages set status = 'draft' where country_code = 'CO' and kind = 'tratamiento_datos' and status = 'published';
insert into public.pages (country_code, slug, title, content_html, version, status, kind)
  values ('CO', 'pgtap-datos-21', 'Datos pgtap', '<p>Política</p>', 2, 'published', 'tratamiento_datos');

create temp table o (id uuid);
insert into o select (public.crear_pedido_checkout(jsonb_build_object(
  'order', jsonb_build_object(
    'country_code', 'CO', 'currency_code', 'COP', 'contact_first_name', 'Ana', 'contact_last_name', 'Paz',
    'contact_phone_e164', '+573001112233', 'payment_method', 'wompi', 'subtotal', '50000', 'discount_amount', 0,
    'total_customer', '50000', 'checkout_idempotency_key', 'tr-pgtap-1', 'terms_accepted_at', now(), 'data_policy_version', '2'),
  'items', jsonb_build_array(jsonb_build_object(
    'product_id', 'a0000000-0000-0000-0000-0000000000e1', 'variant_id', 'f0000000-0000-0000-0000-0000000000e1',
    'sku', 'TR-A', 'name_snapshot', 'Transicion Prueba', 'variant_label', '50 ml', 'quantity', 1, 'unit_price', '50000'))))
  ->'order'->>'id')::uuid;

-- Fábrica: transición del pedido de prueba
create function pg_temp.t(p_de text, p_a text, p_actor text default 'webhook:wompi', p_extra jsonb default '{}')
returns jsonb language sql as $$
  select public.aplicar_transicion_pedido(jsonb_build_object(
    'order_id', (select id from o), 'from_status', p_de, 'to_status', p_a, 'actor', p_actor,
    'payload', jsonb_build_object('payment_id', 'pgtap')) || p_extra);
$$;

-- (a) payments
select has_index('public', 'payments', 'payments_provider_reference_key', array['provider', 'provider_reference'],
                 'índice único (provider, provider_reference)');
insert into public.payments (order_id, provider, purpose, amount, currency_code, provider_reference)
  select id, 'wompi', 'full', 50000, 'COP', 'IZ-PGTAP-P1' from o;
select throws_ok($$ insert into public.payments (order_id, provider, purpose, amount, currency_code, provider_reference)
                    select id, 'wompi', 'full', 50000, 'COP', 'IZ-PGTAP-P1' from o $$,
                 '23505', null, 'misma referencia del mismo proveedor rechazada');
select lives_ok($$ insert into public.payments (order_id, provider, purpose, amount, currency_code, provider_reference)
                   select id, 'addi', 'financing', 50000, 'COP', 'IZ-PGTAP-P1' from o $$,
                'misma referencia en otro proveedor permitida');
select lives_ok($$ insert into public.payments (order_id, provider, purpose, amount, currency_code)
                   select id, 'wompi', 'full', 50000, 'COP' from o union all select id, 'wompi', 'full', 50000, 'COP' from o $$,
                'referencias nulas no chocan');

-- (b) aplicar_transicion_pedido
create temp table r (k text primary key, v jsonb);
insert into r values ('ok', pg_temp.t('pendiente_pago', 'pagado', p_extra => '{"fechas":{"paid_at":"2026-10-20T15:00:00Z"}}'));
insert into r values ('rep', pg_temp.t('pendiente_pago', 'pagado'));

select is(r.v->>'ok', 'true', 'aplica la transición') from r where k = 'ok';
select is((select status from public.orders where id = (select id from o)), 'pagado', 'cambia el estado');
select is((select paid_at from public.orders where id = (select id from o)), '2026-10-20T15:00:00Z'::timestamptz, 'fija paid_at');
select is((select count(*)::int from public.order_events e where e.order_id = (select id from o) and e.type = 'status_changed'
             and e.from_status = 'pendiente_pago' and e.to_status = 'pagado' and e.actor = 'webhook:wompi'
             and e.payload->>'payment_id' = 'pgtap' and e.id::text = (select v->>'event_id' from r where k = 'ok')), 1,
          'registra el evento con actor y payload');
select is(r.v->>'motivo' || '/' || (r.v->>'status_actual'), 'estado_cambiado/pagado', 'repetida: estado_cambiado con el estado actual')
  from r where k = 'rep';
select is((select count(*)::int from public.order_events e where e.order_id = (select id from o) and e.type = 'status_changed'), 1,
          'la repetida no duplica el evento');
select is(public.aplicar_transicion_pedido(jsonb_build_object('order_id', gen_random_uuid(), 'from_status', 'pendiente_pago',
            'to_status', 'pagado', 'actor', 'system'))->>'motivo', 'pedido_inexistente', 'pedido inexistente');
select is(pg_temp.t('pagado', 'en_preparacion', 'intruso')->>'detalle', 'order_events_actor_check',
          'actor inválido: datos_invalidos con la restricción');
select is((select status from public.orders where id = (select id from o)), 'pagado', 'y deshace el cambio de estado (atómica)');
select is(pg_temp.t('pagado', 'volando')->>'detalle', 'orders_status_check', 'estado destino desconocido: datos_invalidos');
select is(pg_temp.t('pagado', 'pagado')->>'detalle', 'mismo_estado', 'mismo estado: datos_invalidos');
select is(pg_temp.t('pagado', 'en_preparacion', p_extra => '{"fechas":{"status":"x"}}')->>'detalle', 'fechas',
          'solo fechas de la lista blanca');
select is(pg_temp.t('pagado', 'en_preparacion', p_extra => '{"fechas":{"delivered_at":"ayer"}}')->>'motivo', 'datos_invalidos',
          'fecha mal formada: datos_invalidos');
select ok(not has_function_privilege('anon', 'public.aplicar_transicion_pedido(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.aplicar_transicion_pedido(jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.aplicar_transicion_pedido(jsonb)', 'execute'),
          'solo service_role ejecuta aplicar_transicion_pedido');

select * from finish();
rollback;
