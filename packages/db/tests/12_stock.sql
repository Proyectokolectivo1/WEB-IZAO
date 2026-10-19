-- Pruebas pgtap · T1.13: reservar_stock / liberar_stock / confirmar_stock (§10.2). Atómicas, idempotentes y solo service_role.
begin;
set local search_path = public, extensions;
select plan(23);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-0000000000e1', 'Stock Prueba', 'stock-prueba', 'active');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('f0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'ST-A', true),   -- ultimo producto (stock 1)
  ('f0000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'ST-B', false),  -- stock 5
  ('f0000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'ST-C', false);  -- inactiva en el pais
insert into public.variant_countries (variant_id, country_code, is_active, price, stock) values
  ('f0000000-0000-0000-0000-0000000000e1', 'CO', true, 100000, 1),
  ('f0000000-0000-0000-0000-0000000000e2', 'CO', true, 100000, 5),
  ('f0000000-0000-0000-0000-0000000000e3', 'CO', false, 100000, 9);

-- Pedidos de prueba: o1 y o2 piden la ultima unidad de A; o3 mezcla B x2 y A; o4 pide la variante inactiva; o5 pide B x2; o6 pide B x9
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
  payment_method, status, subtotal, total_customer) values
  ('d0000000-0000-0000-0000-0000000000e1', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 100000, 100000),
  ('d0000000-0000-0000-0000-0000000000e2', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 100000, 100000),
  ('d0000000-0000-0000-0000-0000000000e3', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 300000, 300000),
  ('d0000000-0000-0000-0000-0000000000e4', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 100000, 100000),
  ('d0000000-0000-0000-0000-0000000000e5', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 200000, 200000),
  ('d0000000-0000-0000-0000-0000000000e6', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 900000, 900000);
insert into public.order_items (order_id, variant_id, sku, name_snapshot, quantity, unit_price) values
  ('d0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-0000000000e1', 'ST-A', 'A', 1, 100000),
  ('d0000000-0000-0000-0000-0000000000e2', 'f0000000-0000-0000-0000-0000000000e1', 'ST-A', 'A', 1, 100000),
  ('d0000000-0000-0000-0000-0000000000e3', 'f0000000-0000-0000-0000-0000000000e2', 'ST-B', 'B', 2, 100000),
  ('d0000000-0000-0000-0000-0000000000e3', 'f0000000-0000-0000-0000-0000000000e1', 'ST-A', 'A', 1, 100000),
  ('d0000000-0000-0000-0000-0000000000e4', 'f0000000-0000-0000-0000-0000000000e3', 'ST-C', 'C', 1, 100000),
  ('d0000000-0000-0000-0000-0000000000e5', 'f0000000-0000-0000-0000-0000000000e2', 'ST-B', 'B', 2, 100000),
  ('d0000000-0000-0000-0000-0000000000e6', 'f0000000-0000-0000-0000-0000000000e2', 'ST-B', 'B', 9, 100000);

-- 1-3 reserva y reintento (idempotente)
select is((public.reservar_stock('d0000000-0000-0000-0000-0000000000e1')->>'ok')::boolean, true, 'o1 reserva la ultima unidad');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e1'), 1, 'stock_reserved de A = 1');
select is(public.reservar_stock('d0000000-0000-0000-0000-0000000000e1')->>'repetido', 'true', 'reservar otra vez es idempotente');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e1'), 1, 'y no duplica la reserva');
select ok((select stock_reserved_until > now() and stock_state = 'reserved' from public.orders where id = 'd0000000-0000-0000-0000-0000000000e1'),
  'el pedido queda reservado con stock_reserved_until segun pending_payment_ttl_minutes');

-- 4 la segunda reserva del ultimo producto pierde
select is(public.reservar_stock('d0000000-0000-0000-0000-0000000000e2')->>'motivo', 'sin_stock', 'o2 no puede reservar la unidad ya reservada');
-- 5 reserva parcial rechazada completa
select is(public.reservar_stock('d0000000-0000-0000-0000-0000000000e3')->>'ok', 'false', 'o3 (B x2 + A) se rechaza completa');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e2'), 0, 'sin reserva parcial: B sigue en 0');
-- 6 variante inactiva
select is(public.reservar_stock('d0000000-0000-0000-0000-0000000000e4')->'faltantes'->0->>'motivo', 'variante_inactiva', 'variante inactiva en el pais');
-- 7 stock insuficiente
select is(public.reservar_stock('d0000000-0000-0000-0000-0000000000e6')->'faltantes'->0->>'motivo', 'stock_insuficiente', 'stock insuficiente');

-- 8 liberar tras expirar, idempotente
select is((public.liberar_stock('d0000000-0000-0000-0000-0000000000e1')->>'ok')::boolean, true, 'liberar el pedido o1');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e1'), 0, 'la unidad vuelve a estar disponible');
select is(public.liberar_stock('d0000000-0000-0000-0000-0000000000e1')->>'repetido', 'true', 'liberar dos veces es idempotente');
select is((select stock_reserved from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e1'), 0, 'liberar dos veces no resta de mas');

-- 9 confirmar: baja stock y stock_reserved a la vez; dos veces no duplica
select is((public.reservar_stock('d0000000-0000-0000-0000-0000000000e2')->>'ok')::boolean, true, 'tras liberar, o2 reserva la ultima unidad');
select is((public.confirmar_stock('d0000000-0000-0000-0000-0000000000e2')->>'ok')::boolean, true, 'o2 confirma el stock al pagar');
select is((select stock::text || '/' || stock_reserved::text from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e1'), '0/0',
  'stock y stock_reserved bajan juntos');
select is(public.confirmar_stock('d0000000-0000-0000-0000-0000000000e2')->>'repetido', 'true', 'confirmar dos veces es idempotente');
select is((select stock from public.variant_countries where variant_id = 'f0000000-0000-0000-0000-0000000000e1'), 0, 'confirmar dos veces no descuenta de mas');

-- 10 pago tardio sin reserva previa: confirma si hay stock (B x2) y se rechaza si no (B x9 con solo 3 libres)
select is((public.confirmar_stock('d0000000-0000-0000-0000-0000000000e5')->>'ok')::boolean, true, 'confirmar sin reserva previa descuenta si hay stock');
select is(public.confirmar_stock('d0000000-0000-0000-0000-0000000000e6')->>'motivo', 'sin_stock', 'confirmar sin stock se rechaza (requiere_reembolso en el worker)');

-- permisos: solo service_role
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservar_stock', 'liberar_stock', 'confirmar_stock')
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'anon y authenticated no ejecutan las funciones de stock');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservar_stock', 'liberar_stock', 'confirmar_stock')
             and has_function_privilege('service_role', p.oid, 'execute') and not p.prosecdef and p.proconfig @> array['search_path=""']), 3,
  'service_role las ejecuta; son security invoker con search_path vacio');

select * from finish();
rollback;
