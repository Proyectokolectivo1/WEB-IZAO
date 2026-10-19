-- Pruebas pgTAP · reglas de negocio en la base: numeración, dinero, estados, códigos y convenciones (§6.1, §11.2, §16)
-- Ejecutar con pg_prove o dentro de una transacción; todo se revierte al final.
begin;
set local search_path = public, extensions;
select plan(16);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP',0,'$','$ #.##0'), ('USD',2,'$','$ #.##0,00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values
  ('CO','Colombia','COP','es-CO','America/Bogota','+57'), ('EC','Ecuador','USD','es-EC','America/Guayaquil','+593') on conflict do nothing;

insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount) values
  ('d0000000-0000-0000-0000-000000000001', 'CO', 'COP', 'A', 'B', '+573000000001', 'cod', 'esperando_abono', 90000, 90000, 10000, 80000);
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer) values
  ('d0000000-0000-0000-0000-000000000002', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 90000, 90000),
  ('d0000000-0000-0000-0000-000000000003', 'EC', 'USD', 'A', 'B', '+593900000001', 'manual', 'pendiente_manual', 9980, 9980);
select matches((select number from public.orders where id = 'd0000000-0000-0000-0000-000000000001'), '^IZ-CO-[0-9]{6}$', 'orders.number con formato IZ-CO-000000');
select ok((select substr(b.number, 7)::int = substr(a.number, 7)::int + 1 from public.orders a, public.orders b where a.id = 'd0000000-0000-0000-0000-000000000001' and b.id = 'd0000000-0000-0000-0000-000000000002'), 'consecutivo por pais incrementa');
select matches((select number from public.orders where id = 'd0000000-0000-0000-0000-000000000003'), '^IZ-EC-[0-9]{6}$', 'secuencia propia para Ecuador');
select ok((select length(public_token) = 32 from public.orders where id = 'd0000000-0000-0000-0000-000000000001'), 'public_token aleatorio de 32 hex');
select throws_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer) values ('CO','COP','A','B','+573000000001','wompi','pendiente_pago',90000,80000)$$, '23514', null, 'total_customer = subtotal - descuento + recargo');
select throws_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount) values ('CO','COP','A','B','+573000000001','cod','esperando_abono',90000,90000,10000,90000)$$, '23514', null, 'contra entrega: recaudo = total - abono');
select throws_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer) values ('CO','COP','A','B','+573000000001','wompi','inventado',1,1)$$, '23514', null, 'status fuera de los 17 estados se rechaza');
select lives_ok($$insert into public.orders (country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, discount_amount, financing_surcharge_pct, financing_surcharge_amount, total_customer) values ('CO','COP','A','B','+573000000001','addi','pendiente_pago',90000,0,10,9000,99000)$$, 'caso 4 de 11.3 cuadra (99.000)');
-- El check real de orders.status admite exactamente los 17 estados de §16
select is(
  (select array_agg(m[1] order by m[1])
     from pg_constraint c
     cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
    where c.conrelid = 'public.orders'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%pendiente_pago%'),
  (select array_agg(s order by s) from unnest(array['pendiente_pago','pago_rechazado','expirado','esperando_abono','abandonado','pendiente_manual',
     'pagado','abono_pagado','error_transportadora','enviado_transportadora','en_preparacion','en_transito','entregado',
     'devuelto','cancelado','reclamacion','requiere_reembolso']) as s),
  'el check de orders.status contiene exactamente los 17 estados de §16');

insert into public.warranty_claims (country_code, customer_name, phone, reason) values ('CO', 'A', '3000000001', 'Atomizador defectuoso');
select matches((select number from public.warranty_claims order by created_at desc limit 1), '^GAR-CO-[0-9]{4}$', 'warranty_claims.number GAR-CO-0000');

select throws_ok($$insert into public.discount_codes (code, country_code, type, value) values ('bienvenida', 'CO', 'percent', 10)$$, '23514', null, 'codigos en mayusculas sin espacios');
select throws_ok($$insert into public.discount_codes (code, country_code, type, value) values ('MAS100', 'CO', 'percent', 150)$$, '23514', null, 'porcentaje entre 1 y 100');
insert into public.discount_codes (code, country_code, type, value) values ('HOLAPGTAP10', 'CO', 'percent', 10);
select throws_ok($$insert into public.discount_codes (code, country_code, type, value) values ('HOLAPGTAP10', 'EC', 'fixed', 500)$$, '23505', null, 'codigo unico sin importar pais');

update public.orders set updated_at = '2000-01-01' where id = 'd0000000-0000-0000-0000-000000000002';
select is((select updated_at from public.orders where id = 'd0000000-0000-0000-0000-000000000002'), now(), 'set_updated_at mantiene updated_at');

select is((select count(*)::int from information_schema.columns where table_schema = 'public' and data_type in ('real','double precision')), 0, 'ninguna columna float');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), 0, 'todas las funciones de public fijan search_path');

select * from finish();
rollback;
