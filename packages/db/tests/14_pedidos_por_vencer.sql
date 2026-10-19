-- Pruebas pgtap · T1.15: pedidos_por_vencer(ahora, limite) devuelve los pedidos con reserva vencida para que el worker los expire.
begin;
set local search_path = public, extensions;
select plan(9);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;

-- v8 pago_rechazado vencido (A2: tambien libera stock y canje); v1 pendiente_pago vencido; v2 esperando_abono vencido; v3 pendiente_manual vencido (D-002); v4 pendiente_pago vigente;
-- v5 pagado con fecha vieja (no aplica); v6 sin fecha; v7 expirado ya procesado (no aplica)
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
  payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount, stock_reserved_until) values
  ('d0000000-0000-0000-0000-0000000000a1', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 1000, 0, 0, now() - interval '3 hours'),
  ('d0000000-0000-0000-0000-0000000000a2', 'CO', 'COP', 'A', 'B', '+573000000001', 'cod', 'esperando_abono', 1000, 1000, 100, 900, now() - interval '2 hours'),
  ('d0000000-0000-0000-0000-0000000000a3', 'CO', 'COP', 'A', 'B', '+573000000001', 'manual', 'pendiente_manual', 1000, 1000, 0, 0, now() - interval '1 hour'),
  ('d0000000-0000-0000-0000-0000000000a4', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 1000, 0, 0, now() + interval '1 hour'),
  ('d0000000-0000-0000-0000-0000000000a5', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pagado', 1000, 1000, 0, 0, now() - interval '5 hours'),
  ('d0000000-0000-0000-0000-0000000000a6', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 1000, 1000, 0, 0, null),
  ('d0000000-0000-0000-0000-0000000000a7', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'expirado', 1000, 1000, 0, 0, now() - interval '9 hours'),
  ('d0000000-0000-0000-0000-0000000000a8', 'CO', 'COP', 'A', 'B', '+573000000001', 'addi', 'pago_rechazado', 1000, 1000, 0, 0, now() - interval '4 hours');

select results_eq(
  $$select order_id::text from public.pedidos_por_vencer(now()) where order_id::text like 'd0000000-0000-0000-0000-0000000000a%' order by stock_reserved_until$$,
  $$values ('d0000000-0000-0000-0000-0000000000a8'), ('d0000000-0000-0000-0000-0000000000a1'), ('d0000000-0000-0000-0000-0000000000a2'), ('d0000000-0000-0000-0000-0000000000a3')$$,
  'devuelve solo los vencidos en pago_rechazado, pendiente_pago, esperando_abono y pendiente_manual, del mas viejo al mas nuevo');
select results_eq(
  $$select estado_actual || '>' || nuevo_estado from public.pedidos_por_vencer(now()) where order_id::text like 'd0000000-0000-0000-0000-0000000000a%' order by stock_reserved_until$$,
  $$values ('pago_rechazado>expirado'), ('pendiente_pago>expirado'), ('esperando_abono>abandonado'), ('pendiente_manual>expirado')$$,
  'propone el estado nuevo: expirado (rechazado y pendiente_pago), abandonado y expirado (D-002)');
select is((select count(*)::int from public.pedidos_por_vencer(now() - interval '150 minutes') where order_id::text like 'd0000000-0000-0000-0000-0000000000a%'), 2,
  'con una fecha anterior vencen solo los dos mas viejos (rechazado y pendiente_pago)');
select is((select count(*)::int from public.pedidos_por_vencer(now() + interval '2 hours') where order_id::text like 'd0000000-0000-0000-0000-0000000000a%'), 5,
  'con una fecha futura vence tambien el que estaba vigente');
select is((select count(*)::int from public.pedidos_por_vencer(now(), 2)), 2, 'respeta el limite');
select ok((select pg_get_indexdef('public.orders_stock_reserved_until_idx'::regclass) like '%pago_rechazado%'), 'el indice parcial incluye pago_rechazado');
select has_index('public', 'orders', 'orders_stock_reserved_until_idx', 'existe el indice parcial por stock_reserved_until');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pedidos_por_vencer'
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'anon y authenticated no la ejecutan');
select is((select provolatile::text from pg_proc where proname = 'pedidos_por_vencer' and pronamespace = 'public'::regnamespace), 's',
  'es de solo lectura (stable)');

select * from finish();
rollback;
