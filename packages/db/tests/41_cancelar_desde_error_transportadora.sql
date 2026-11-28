-- Pruebas pgtap · 20261127180000 (D-061): cancelar_pedido acepta error_transportadora con motivo obligatorio,
-- devuelve el stock confirmado y deja la alerta reembolso_manual_pendiente con los pagos aprobados.
-- Lo existente (otros from_status, privilegios, search_path) no cambia.
begin;
set local search_path = public, extensions;
select plan(24);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('c4100000-0000-0000-0000-000000000001', 'Pgtap Cuarenta y uno', 'pgtap-41', 'active');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('c4110000-0000-0000-0000-000000000001', 'c4100000-0000-0000-0000-000000000001', 'PG41-A', true);
insert into public.variant_countries (variant_id, country_code, price, stock) values
  ('c4110000-0000-0000-0000-000000000001', 'CO', 169900, 10);

-- A: pago completo Wompi aprobado. B: contra entrega con abono aprobado (y un intento rechazado).
-- C: pago manual (paid_at, sin fila en payments). D: en_preparacion, regresión de otro from_status.
insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
                           payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount, paid_at) values
  ('c4600000-0000-0000-0000-000000000001', 'PGTAP41-A', 'CO', 'COP', 'C', 'A', '+573005551001', 'wompi', 'error_transportadora', 169900, 169900, 0, 0, now()),
  ('c4600000-0000-0000-0000-000000000002', 'PGTAP41-B', 'CO', 'COP', 'C', 'B', '+573005551002', 'cod', 'error_transportadora', 169900, 169900, 15000, 154900, null),
  ('c4600000-0000-0000-0000-000000000003', 'PGTAP41-C', 'CO', 'COP', 'C', 'C', '+573005551003', 'manual', 'error_transportadora', 169900, 169900, 0, 0, now()),
  ('c4600000-0000-0000-0000-000000000004', 'PGTAP41-D', 'CO', 'COP', 'C', 'D', '+573005551004', 'wompi', 'en_preparacion', 169900, 169900, 0, 0, now());
insert into public.order_items (order_id, product_id, variant_id, sku, name_snapshot, quantity, unit_price) values
  ('c4600000-0000-0000-0000-000000000001', 'c4100000-0000-0000-0000-000000000001', 'c4110000-0000-0000-0000-000000000001', 'PG41-A', 'A', 1, 169900),
  ('c4600000-0000-0000-0000-000000000002', 'c4100000-0000-0000-0000-000000000001', 'c4110000-0000-0000-0000-000000000001', 'PG41-A', 'A', 1, 169900),
  ('c4600000-0000-0000-0000-000000000003', 'c4100000-0000-0000-0000-000000000001', 'c4110000-0000-0000-0000-000000000001', 'PG41-A', 'A', 1, 169900),
  ('c4600000-0000-0000-0000-000000000004', 'c4100000-0000-0000-0000-000000000001', 'c4110000-0000-0000-0000-000000000001', 'PG41-A', 'A', 1, 169900);
insert into public.payments (id, order_id, provider, purpose, amount, currency_code, status, provider_reference, provider_transaction_id) values
  ('c4500000-0000-0000-0000-000000000001', 'c4600000-0000-0000-0000-000000000001', 'wompi', 'full', 169900, 'COP', 'approved', 'IZ-CO-PG41A-1', 'pg41-tx-a'),
  ('c4500000-0000-0000-0000-000000000002', 'c4600000-0000-0000-0000-000000000002', 'wompi', 'cod_deposit', 15000, 'COP', 'declined', 'IZ-CO-PG41B-1', 'pg41-tx-b0'),
  ('c4500000-0000-0000-0000-000000000003', 'c4600000-0000-0000-0000-000000000002', 'wompi', 'cod_deposit', 15000, 'COP', 'approved', 'IZ-CO-PG41B-2', 'pg41-tx-b1');
select is(public.confirmar_stock('c4600000-0000-0000-0000-000000000001') ->> 'estado', 'confirmed', 'A: stock confirmado por el pago');
select is(public.confirmar_stock('c4600000-0000-0000-0000-000000000002') ->> 'estado', 'confirmed', 'B: stock confirmado por el abono');
select is(public.confirmar_stock('c4600000-0000-0000-0000-000000000003') ->> 'estado', 'confirmed', 'C: stock confirmado por el pago manual');
select is(public.confirmar_stock('c4600000-0000-0000-0000-000000000004') ->> 'estado', 'confirmed', 'D: stock confirmado');
-- MasterShop rechazó la creación: ninguno tiene shipments.provider_order_id.
select is((select stock from public.variant_countries where variant_id = 'c4110000-0000-0000-0000-000000000001'), 6, 'stock tras los pagos: 10-4=6');

-- Privilegios y configuración intactos.
select ok(not has_function_privilege('anon', 'public.cancelar_pedido(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.cancelar_pedido(jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.cancelar_pedido(jsonb)', 'execute'), 'cancelar_pedido: solo service_role');
select is((select proconfig from pg_proc where oid = 'public.cancelar_pedido(jsonb)'::regprocedure), '{"search_path=\"\""}'::text[], 'cancelar_pedido: search_path vacío');

-- Motivo obligatorio desde error_transportadora.
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000001","from_status":"error_transportadora","actor":"admin:pg41"}'),
          '{"ok": false, "motivo": "datos_invalidos", "detalle": "motivo"}'::jsonb, 'sin motivo: datos_invalidos');
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000001","from_status":"error_transportadora","actor":"admin:pg41","motivo":"   "}') ->> 'detalle',
          'motivo', 'motivo en blanco: datos_invalidos');
select is((select status from public.orders where id = 'c4600000-0000-0000-0000-000000000001'), 'error_transportadora', 'A: sin motivo no cambia nada');

-- A: pago completo Wompi.
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000001","from_status":"error_transportadora","actor":"admin:pg41","motivo":"MasterShop rechazó la ciudad"}') - 'event_id',
          '{"ok": true, "order_id": "c4600000-0000-0000-0000-000000000001", "from_status": "error_transportadora", "to_status": "cancelado",
            "stock_estado": "released", "stock_liberado": false, "stock_devuelto": true, "unidades_devueltas": 1, "stock_retenido": null,
            "reembolso_pendiente": true,
            "pagos_a_reembolsar": [{"payment_id": "c4500000-0000-0000-0000-000000000001", "provider": "wompi", "purpose": "full", "amount": 169900,
                                    "currency_code": "COP", "provider_reference": "IZ-CO-PG41A-1", "provider_transaction_id": "pg41-tx-a"}]}'::jsonb,
          'A: cancela, devuelve el stock y marca el reembolso');
select is((select stock from public.variant_countries where variant_id = 'c4110000-0000-0000-0000-000000000001'), 7, 'A: el stock vuelve (6+1)');
select results_eq($$ select status, cancelled_at is not null from public.orders where id = 'c4600000-0000-0000-0000-000000000001' $$,
                  $$ values ('cancelado'::text, true) $$, 'A: cancelado con cancelled_at');
select is((select payload from public.order_events where order_id = 'c4600000-0000-0000-0000-000000000001' and type = 'status_changed'),
          '{"motivo": "MasterShop rechazó la ciudad"}'::jsonb, 'A: el cambio de estado lleva el motivo');
select is((select payload - 'pagos' from public.order_events where order_id = 'c4600000-0000-0000-0000-000000000001' and type = 'alerta'),
          '{"motivo": "reembolso_manual_pendiente", "desde": "error_transportadora", "motivo_cancelacion": "MasterShop rechazó la ciudad", "pago_fuera_de_pasarela": false}'::jsonb,
          'A: alerta reembolso_manual_pendiente');
select is((select actor from public.order_events where order_id = 'c4600000-0000-0000-0000-000000000001' and type = 'alerta'), 'admin:pg41', 'A: la alerta lleva el actor');
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000001","from_status":"error_transportadora","actor":"admin:pg41","motivo":"otra vez"}') ->> 'motivo',
          'estado_cambiado', 'A: cancelar dos veces: estado_cambiado');
select is((select count(*)::int from public.order_events where order_id = 'c4600000-0000-0000-0000-000000000001' and type in ('alerta', 'stock_devuelto')), 2,
          'A: la segunda llamada no duplica alerta ni devolución');

-- B: abono de contra entrega; solo el aprobado se reembolsa.
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000002","from_status":"error_transportadora","actor":"admin:pg41","motivo":"Cliente desistió"}') -> 'pagos_a_reembolsar',
          '[{"payment_id": "c4500000-0000-0000-0000-000000000003", "provider": "wompi", "purpose": "cod_deposit", "amount": 15000,
             "currency_code": "COP", "provider_reference": "IZ-CO-PG41B-2", "provider_transaction_id": "pg41-tx-b1"}]'::jsonb,
          'B: solo el abono aprobado queda por reembolsar');
select is((select stock from public.variant_countries where variant_id = 'c4110000-0000-0000-0000-000000000001'), 8, 'B: el stock vuelve (7+1)');

-- C: pago manual sin fila en payments: alerta igual, marcada fuera de pasarela.
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000003","from_status":"error_transportadora","actor":"admin:pg41","motivo":"Sin cobertura"}')
            -> 'reembolso_pendiente', 'true'::jsonb, 'C: pago manual también queda por reembolsar');
select is((select payload -> 'pago_fuera_de_pasarela' from public.order_events where order_id = 'c4600000-0000-0000-0000-000000000003' and type = 'alerta'),
          'true'::jsonb, 'C: alerta marcada fuera de pasarela');

-- D: regresión. Otros from_status siguen igual: sin motivo obligatorio, sin claves nuevas y sin alerta.
select is(public.cancelar_pedido('{"order_id":"c4600000-0000-0000-0000-000000000004","from_status":"en_preparacion","actor":"webhook:mastershop"}') - 'event_id',
          '{"ok": true, "order_id": "c4600000-0000-0000-0000-000000000004", "from_status": "en_preparacion", "to_status": "cancelado",
            "stock_estado": "released", "stock_liberado": false, "stock_devuelto": true, "unidades_devueltas": 1, "stock_retenido": null}'::jsonb,
          'D: en_preparacion cancela como antes (sin motivo, sin claves de reembolso)');
select ok(not exists (select 1 from public.order_events where order_id = 'c4600000-0000-0000-0000-000000000004' and type = 'alerta'), 'D: sin alerta de reembolso');

select * from finish();
rollback;
