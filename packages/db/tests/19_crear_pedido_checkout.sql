-- Pruebas pgtap · T3.1b: crear_pedido_checkout (§10.2, §11, §17.1). Transaccional (todo o nada), idempotente y solo service_role.
begin;
set local search_path = public, extensions;
select plan(30);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-0000000000c1', 'Checkout Prueba', 'checkout-prueba', 'active');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('f0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'CK-A', true),   -- stock 1
  ('f0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c1', 'CK-B', false);  -- stock 10
insert into public.variant_countries (variant_id, country_code, is_active, price, stock) values
  ('f0000000-0000-0000-0000-0000000000c1', 'CO', true, 100000, 1),
  ('f0000000-0000-0000-0000-0000000000c2', 'CO', true, 50000, 10);
-- un solo uso en total
insert into public.discount_codes (id, code, country_code, type, value, usage_limit_total)
  values ('c0000000-0000-0000-0000-0000000000c1', 'CHECKOUTPGTAP', 'CO', 'percent', 10, 1);

-- Fábrica de payloads: B x cantidad (+ A x1 si p_con_a), método, código opcional y clave
create function pg_temp.p(p_clave text, p_metodo text default 'wompi', p_cant int default 1, p_con_a boolean default false,
                          p_codigo uuid default null, p_extra jsonb default '{}')
returns jsonb language sql as $$
  with l as (
    select jsonb_build_object('product_id', 'a0000000-0000-0000-0000-0000000000c1', 'variant_id', 'f0000000-0000-0000-0000-0000000000c2',
             'sku', 'CK-B', 'name_snapshot', 'Checkout Prueba', 'variant_label', '50 ml', 'quantity', p_cant, 'unit_price', '50000',
             'unit_cost', 20000, 'line_discount', case when p_codigo is null then 0 else 5000 * p_cant end) as b,
           jsonb_build_object('product_id', 'a0000000-0000-0000-0000-0000000000c1', 'variant_id', 'f0000000-0000-0000-0000-0000000000c1',
             'sku', 'CK-A', 'name_snapshot', 'Checkout Prueba', 'variant_label', '100 ml', 'quantity', 1, 'unit_price', 100000,
             'line_discount', 0) as a
  ), t as (
    select 50000 * p_cant + case when p_con_a then 100000 else 0 end as sub,
           case when p_codigo is null then 0 else 5000 * p_cant end as des
  )
  select jsonb_build_object(
    'order', jsonb_build_object(
      'country_code', 'CO', 'currency_code', 'COP', 'contact_first_name', 'Ana', 'contact_last_name', 'Paz',
      'contact_phone_e164', '+573001112233', 'contact_email', 'ana@test.local', 'document_type', 'CC', 'document_number', '1020304050',
      'payment_method', p_metodo, 'subtotal', t.sub::text, 'discount_code_id', p_codigo, 'discount_amount', t.des,
      'financing_surcharge_pct', '0.00', 'financing_surcharge_amount', '0', 'total_customer', (t.sub - t.des)::text,
      'cod_deposit_amount', case when p_metodo = 'cod' then '20000' else '0' end,
      'cod_collect_amount', case when p_metodo = 'cod' then (t.sub - t.des - 20000)::text else '0' end,
      'product_cost_total', '20000', 'checkout_idempotency_key', p_clave, 'terms_accepted_at', now(),
      'data_policy_version', 'v1', 'whatsapp_opt_in', true) || p_extra,
    'items', case when p_con_a then jsonb_build_array(l.b, l.a) else jsonb_build_array(l.b) end)
  from l, t;
$$;

create temp table r (k text primary key, v jsonb);
insert into r values ('c1', public.crear_pedido_checkout(pg_temp.p('ck-pgtap-1', p_cant => 2, p_con_a => true)));

-- 1. Creación completa
select is(r.v->>'ok', 'true', 'crea el pedido') from r where k = 'c1';
select is(r.v->>'estado', 'creado', 'estado creado y repetido = false') from r where k = 'c1' and r.v->>'repetido' = 'false';
select is(r.v->'order'->>'status', 'pendiente_pago', 'wompi: estado inicial pendiente_pago') from r where k = 'c1';
select ok(r.v->'order'->>'number' ~ '^IZ-', 'tiene número de pedido') from r where k = 'c1';
select is(jsonb_array_length(r.v->'order'->'lines'), 2, 'devuelve las 2 líneas') from r where k = 'c1';
select is(r.v->'order'->>'total_customer', '200000', 'montos en texto: total 200000') from r where k = 'c1';
select is((select sum(stock_reserved)::int from public.variant_countries where variant_id in
           ('f0000000-0000-0000-0000-0000000000c1', 'f0000000-0000-0000-0000-0000000000c2')), 3, 'reserva stock: A 1 + B 2');
select is((select stock_state from public.orders where checkout_idempotency_key = 'ck-pgtap-1'), 'reserved', 'stock_state = reserved');
select is((select count(*)::int from public.order_events e join public.orders o on o.id = e.order_id
            where o.checkout_idempotency_key = 'ck-pgtap-1' and e.type = 'created' and e.to_status = 'pendiente_pago' and e.from_status is null), 1,
  'registra un evento created');

-- 2. Idempotencia
insert into r values ('c1b', public.crear_pedido_checkout(pg_temp.p('ck-pgtap-1', p_cant => 2, p_con_a => true)));
select is(r.v->>'repetido', 'true', 'misma clave: repetido') from r where k = 'c1b';
select is((select v->'order'->>'id' from r where k = 'c1b'), (select v->'order'->>'id' from r where k = 'c1'), 'devuelve el mismo pedido');
select is((select sum(stock_reserved)::int from public.variant_countries where variant_id in
           ('f0000000-0000-0000-0000-0000000000c1', 'f0000000-0000-0000-0000-0000000000c2')), 3, 'y no reserva dos veces');
select is(public.crear_pedido_checkout(pg_temp.p('ck-pgtap-1', p_extra => '{"country_code":"EC"}'))->>'motivo', 'idempotencia_conflicto',
  'misma clave en otro país: idempotencia_conflicto');

-- 3. Sin stock: todo o nada
insert into r values ('s1', public.crear_pedido_checkout(pg_temp.p('ck-pgtap-2', p_con_a => true)));
select is(r.v->>'motivo', 'sin_stock', 'A agotada: sin_stock') from r where k = 's1';
select is(jsonb_array_length(r.v->'faltantes'), 1, 'con la línea faltante') from r where k = 's1';
select is((select count(*)::int from public.orders where checkout_idempotency_key = 'ck-pgtap-2'), 0, 'no deja pedido huérfano');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000c2'), 2,
  'ni reserva B (la línea con stock)');

-- 4. Código: el primero lo usa; el segundo se rechaza y se deshace el stock ya reservado
select is(public.crear_pedido_checkout(pg_temp.p('ck-pgtap-3', p_codigo => 'c0000000-0000-0000-0000-0000000000c1'))->'order'->>'discount_amount', '5000',
  'con código: aplica el descuento');
select is((select payload->>'discount_code' from public.order_events e join public.orders o on o.id = e.order_id
            where o.checkout_idempotency_key = 'ck-pgtap-3' and e.type = 'created'), 'CHECKOUTPGTAP', 'el evento guarda el código');
select is(public.crear_pedido_checkout(pg_temp.p('ck-pgtap-4', p_codigo => 'c0000000-0000-0000-0000-0000000000c1'))->>'motivo', 'limite_total',
  'código agotado: limite_total');
select is((select count(*)::int from public.orders where checkout_idempotency_key = 'ck-pgtap-4'), 0, 'sin pedido');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000c2'), 3,
  'y el stock reservado antes del canje se devuelve (B = 2 + 1 del pedido con código)');

-- 5. Contra entrega y lista blanca
insert into r values ('cod', public.crear_pedido_checkout(pg_temp.p('ck-pgtap-5', 'cod',
  p_extra => '{"status":"pagado","number":"HACK-1","stock_state":"confirmed","id":"d0000000-0000-0000-0000-0000000000c9"}')));
select is(r.v->'order'->>'status', 'esperando_abono', 'cod: esperando_abono aunque el payload diga pagado') from r where k = 'cod';
select ok(r.v->'order'->>'number' <> 'HACK-1' and r.v->'order'->>'id' <> 'd0000000-0000-0000-0000-0000000000c9',
  'ignora number e id del payload') from r where k = 'cod';

-- 6. Rechazos de datos (nada queda escrito)
select is(public.crear_pedido_checkout(pg_temp.p('ck-pgtap-6', p_extra => '{"subtotal":"40000","total_customer":"40000"}'))->>'motivo', 'totales_inconsistentes',
  'subtotal distinto de Σ líneas: totales_inconsistentes');
select is(public.crear_pedido_checkout(pg_temp.p('ck-pgtap-7', 'cod', p_extra => '{"cod_collect_amount":"1"}'))->>'detalle', 'orders_cod_check',
  'recaudo que no cuadra: datos_invalidos con la restricción');
select is(public.crear_pedido_checkout(pg_temp.p('ck-pgtap-8', 'efectivo'))->>'detalle', 'payment_method', 'método desconocido: datos_invalidos');
select is(public.crear_pedido_checkout(jsonb_set(pg_temp.p('ck-pgtap-9'), '{items}', '[]'))->>'motivo', 'sin_items', 'sin líneas: sin_items');
select is((select count(*)::int from public.orders where checkout_idempotency_key in ('ck-pgtap-6', 'ck-pgtap-7', 'ck-pgtap-8', 'ck-pgtap-9')), 0,
  'ningún rechazo deja pedido');

-- 7. Permisos
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('crear_pedido_checkout', 'pedido_checkout_resumen', 'pedido_checkout_existente')
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'anon y authenticated no ejecutan las funciones del checkout');

select * from finish();
rollback;
