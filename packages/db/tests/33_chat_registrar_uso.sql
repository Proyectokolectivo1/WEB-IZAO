-- Pruebas pgtap · 20261031043504: chat_registrar_uso (consumo mensual del chat de Iza, atómico).
begin;
set local search_path = public, extensions;
select plan(9);

select ok(not has_function_privilege('anon', 'public.chat_registrar_uso(bigint, integer, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.chat_registrar_uso(bigint, integer, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.chat_registrar_uso(bigint, integer, timestamptz)', 'execute'),
          'chat_registrar_uso: solo service_role');

-- Meses de prueba en 1990 (sin datos reales).
select is(public.chat_registrar_uso(1500, 1, '1990-03-10 12:00Z'), 1500::bigint, 'primer uso del mes crea la fila');
select is(public.chat_registrar_uso(2500, 1, '1990-03-20 12:00Z'), 4000::bigint, 'segundo uso suma y devuelve el total');
select is(public.chat_registrar_uso(9000000000000, 2, '1990-03-21 12:00Z'), 9000000004000::bigint, 'montos bigint grandes');
select is((select messages from public.chat_usage_monthly where month = '1990-03-01'), 4, 'suma los mensajes');
-- 1-abr 03:00 UTC = 31-mar 22:00 en Bogotá: cuenta en marzo.
select is(public.chat_registrar_uso(1, 1, '1990-04-01 03:00Z'), 9000000004001::bigint, 'el mes se toma en hora de Bogotá');
select is(public.chat_registrar_uso(0, 0, '1990-04-01 06:00Z'), 0::bigint, 'abril (Bogotá) arranca en 0');
select throws_ok($$ select public.chat_registrar_uso(-1) $$, '22023', null, 'costo negativo -> 22023');
select throws_ok($$ select public.chat_registrar_uso(null) $$, '22023', null, 'costo nulo -> 22023');

select * from finish();
rollback;
