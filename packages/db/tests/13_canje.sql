-- Pruebas pgtap · T1.14: reservar_canje / confirmar_canje / liberar_canje (§17.1). Límites exactos, idempotencia y solo service_role.
begin;
set local search_path = public, extensions;
select plan(23);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
-- limite total 2 y 1 uso por cliente
insert into public.discount_codes (id, code, country_code, type, value, usage_limit_total, usage_limit_per_customer)
  values ('c0000000-0000-0000-0000-0000000000f1', 'CANJEPGTAP', 'CO', 'percent', 10, 2, 1);
insert into public.discount_codes (id, code, country_code, type, value, is_active)
  values ('c0000000-0000-0000-0000-0000000000f2', 'INACTIVOPGTAP', 'CO', 'percent', 10, false);

-- c1 base; c2 y c3 clientes distintos; c4 repite el correo de c1; c5 repite el celular de c2; c6 repite el documento de c1; c7 sin codigo; c8 codigo inactivo
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, contact_email, document_number,
  payment_method, status, subtotal, discount_code_id, discount_amount, total_customer) values
  ('d0000000-0000-0000-0000-0000000000f1', 'CO', 'COP', 'A', 'B', '+573000000011', 'uno@test.local', '1000000001', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f1', 10000, 90000),
  ('d0000000-0000-0000-0000-0000000000f2', 'CO', 'COP', 'A', 'B', '+573000000012', 'dos@test.local', '1000000002', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f1', 10000, 90000),
  ('d0000000-0000-0000-0000-0000000000f3', 'CO', 'COP', 'A', 'B', '+573000000013', 'tres@test.local', '1000000003', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f1', 10000, 90000),
  ('d0000000-0000-0000-0000-0000000000f4', 'CO', 'COP', 'A', 'B', '+573000000014', 'UNO@test.local ', '1000000004', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f1', 10000, 90000),
  ('d0000000-0000-0000-0000-0000000000f5', 'CO', 'COP', 'A', 'B', '+573000000012', 'cinco@test.local', '1000000005', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f1', 10000, 90000),
  ('d0000000-0000-0000-0000-0000000000f6', 'CO', 'COP', 'A', 'B', '+573000000016', 'seis@test.local', '1.000.000-001', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f1', 10000, 90000),
  ('d0000000-0000-0000-0000-0000000000f7', 'CO', 'COP', 'A', 'B', '+573000000017', 'siete@test.local', '1000000007', 'wompi', 'pendiente_pago', 100000, null, 0, 100000),
  ('d0000000-0000-0000-0000-0000000000f8', 'CO', 'COP', 'A', 'B', '+573000000018', 'ocho@test.local', '1000000008', 'wompi', 'pendiente_pago', 100000, 'c0000000-0000-0000-0000-0000000000f2', 10000, 90000);

select is((public.reservar_canje('d0000000-0000-0000-0000-0000000000f1')->>'ok')::boolean, true, 'c1 reserva el canje');
select is((select usage_count from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000f1'), 1, 'usage_count = 1');
select is((select array_length(customer_keys, 1) from public.discount_redemptions where order_id = 'd0000000-0000-0000-0000-0000000000f1'), 3,
  'se guardan las 3 claves del cliente (documento, celular, correo)');
select is(public.reservar_canje('d0000000-0000-0000-0000-0000000000f1')->>'repetido', 'true', 'reservar dos veces es idempotente');
select is((select usage_count from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000f1'), 1, 'y no duplica el uso');

-- limite por cliente: mismo correo (con mayusculas y espacios), mismo documento con puntos
select is(public.reservar_canje('d0000000-0000-0000-0000-0000000000f4')->>'motivo', 'limite_por_cliente', 'mismo correo (normalizado): limite por cliente');
select is(public.reservar_canje('d0000000-0000-0000-0000-0000000000f6')->>'motivo', 'limite_por_cliente', 'mismo documento (normalizado): limite por cliente');

-- limite total exacto
select is((public.reservar_canje('d0000000-0000-0000-0000-0000000000f2')->>'ok')::boolean, true, 'c2 reserva (segundo y ultimo uso)');
select is(public.reservar_canje('d0000000-0000-0000-0000-0000000000f3')->>'motivo', 'limite_total', 'c3 supera el limite total exacto');
select is((select usage_count from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000f1'), 2, 'usage_count nunca supera el limite');

-- liberar (expira/abandona) e idempotencia
select is((public.liberar_canje('d0000000-0000-0000-0000-0000000000f2')->>'ok')::boolean, true, 'liberar el canje de c2');
select is((select usage_count from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000f1'), 1, 'liberar baja usage_count');
select is(public.liberar_canje('d0000000-0000-0000-0000-0000000000f2')->>'repetido', 'true', 'liberar dos veces es idempotente');
select is((select usage_count from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000f1'), 1, 'y no resta de mas');
select is((public.reservar_canje('d0000000-0000-0000-0000-0000000000f3')->>'ok')::boolean, true, 'el cupo liberado lo toma c3');

-- confirmar
select is((public.confirmar_canje('d0000000-0000-0000-0000-0000000000f1')->>'estado'), 'confirmed', 'c1 confirma al pagar');
select is(public.confirmar_canje('d0000000-0000-0000-0000-0000000000f1')->>'repetido', 'true', 'confirmar dos veces es idempotente');
select is((select usage_count from public.discount_codes where id = 'c0000000-0000-0000-0000-0000000000f1'), 2, 'confirmar no cambia usage_count');
select is(public.liberar_canje('d0000000-0000-0000-0000-0000000000f1')->>'estado', 'confirmed', 'un canje confirmado no se libera');
-- pago tardio sin cupo
select is(public.confirmar_canje('d0000000-0000-0000-0000-0000000000f5')->>'motivo', 'limite_total', 'pago tardio sin cupo no confirma');

-- sin codigo e inactivo
select is(public.reservar_canje('d0000000-0000-0000-0000-0000000000f7')->>'estado', 'sin_codigo', 'pedido sin codigo: nada que hacer');
select is(public.reservar_canje('d0000000-0000-0000-0000-0000000000f8')->>'motivo', 'codigo_inactivo', 'codigo inactivo se rechaza');

-- permisos
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('reservar_canje', 'confirmar_canje', 'liberar_canje', 'claves_cliente')
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'anon y authenticated no ejecutan las funciones de canje');

select * from finish();
rollback;
