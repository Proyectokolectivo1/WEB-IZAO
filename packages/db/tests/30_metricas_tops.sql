-- Pruebas pgtap · 20261025141454: RPC de tops del dashboard (§21.3), orders.sale_source y media.kind = 'expense'.
begin;
set local search_path = public, extensions;
select plan(47);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.currencies (code, exponent, symbol, format_pattern) values ('USD', 2, 'US$', 'US$ #,##0.00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('EC', 'Ecuador', 'USD', 'es-EC', 'America/Guayaquil', '+593') on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- Estructura y privilegios
-- ---------------------------------------------------------------------------------------------------------
select has_column('public', 'orders', 'sale_source', 'existe orders.sale_source');
select col_not_null('public', 'orders', 'sale_source', 'sale_source es not null');
select is((select attgenerated::text from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'sale_source'),
          's', 'sale_source es columna generada stored');
select has_index('public', 'orders', 'orders_country_atribucion_idx', 'índice de atribución por país');

select ok(not has_function_privilege('anon', 'public.metricas_top_ciudades(text, date, date, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.metricas_top_ciudades(text, date, date, integer)', 'execute')
          and has_function_privilege('service_role', 'public.metricas_top_ciudades(text, date, date, integer)', 'execute'),
          'metricas_top_ciudades: solo service_role');
select ok(not has_function_privilege('anon', 'public.metricas_top_departamentos(text, date, date, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.metricas_top_departamentos(text, date, date, integer)', 'execute')
          and has_function_privilege('service_role', 'public.metricas_top_departamentos(text, date, date, integer)', 'execute'),
          'metricas_top_departamentos: solo service_role');
select ok(not has_function_privilege('anon', 'public.metricas_top_productos(text, date, date, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.metricas_top_productos(text, date, date, integer)', 'execute')
          and has_function_privilege('service_role', 'public.metricas_top_productos(text, date, date, integer)', 'execute'),
          'metricas_top_productos: solo service_role');
select ok(not has_function_privilege('anon', 'public.metricas_top_agrupado(text, date, date, text, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.metricas_top_agrupado(text, date, date, text, integer)', 'execute')
          and has_function_privilege('service_role', 'public.metricas_top_agrupado(text, date, date, text, integer)', 'execute'),
          'metricas_top_agrupado: solo service_role');
select ok(not has_function_privilege('anon', 'public.metricas_panel_guias(text, date, date)', 'execute')
          and not has_function_privilege('authenticated', 'public.metricas_panel_guias(text, date, date)', 'execute')
          and has_function_privilege('service_role', 'public.metricas_panel_guias(text, date, date)', 'execute'),
          'metricas_panel_guias: solo service_role');
select ok(not has_function_privilege('anon', 'public.metricas_periodo(text, date, date, integer)', 'execute')
          and not has_function_privilege('anon', 'public.metricas_estados_pagados()', 'execute'),
          'auxiliares metricas_periodo y metricas_estados_pagados: sin anon');

-- ---------------------------------------------------------------------------------------------------------
-- fuente_venta (= fuenteDeVenta de lib/admin/metricas/dashboard.ts)
-- ---------------------------------------------------------------------------------------------------------
select is(public.fuente_venta('{"utm_source":"  Google ","utm_medium":" CPC "}', '{}'), 'google / cpc', 'origen / medio recortados y en minúsculas');
select is(public.fuente_venta('{"utm_source":"  ","source":"IG"}', '{}'), 'ig', 'utm_source en blanco cae a source');
select is(public.fuente_venta('{"utm_source":"a"}', '{"ttclid":"t"}'), 'a', 'UTM gana sobre click IDs');
select is(public.fuente_venta('{"utm_source":5}', '{"fbclid":"x"}'), 'meta (clic de anuncio)', 'utm no texto se ignora; fbclid = meta');
select is(public.fuente_venta('{}', '{"fbclid":"","gclid":"y"}'), 'google (clic de anuncio)', 'fbclid vacío no cuenta; gclid = google');
select is(public.fuente_venta('{}', '{"ttclid":"z"}'), 'tiktok (clic de anuncio)', 'ttclid = tiktok');
select is(public.fuente_venta('[]', '"x"'), 'Directo o sin fuente', 'JSON que no es objeto: sin fuente');
select is(public.fuente_venta(jsonb_build_object('utm_source', repeat('x', 45)), '{}'), repeat('x', 40), 'origen recortado a 40 caracteres');

-- ---------------------------------------------------------------------------------------------------------
-- media.kind = 'expense'
-- ---------------------------------------------------------------------------------------------------------
select lives_ok($$ insert into public.media (kind, base_path) values ('expense', 'gastos/pgtap-30') $$, 'media acepta kind expense');
select throws_ok($$ insert into public.media (kind, base_path) values ('otro', 'x/pgtap-30') $$, '23514', null, 'media rechaza un kind desconocido');

-- ---------------------------------------------------------------------------------------------------------
-- Datos: marzo de 2020 (fuera de cualquier dato real), Colombia
-- ---------------------------------------------------------------------------------------------------------
insert into public.products (id, name, slug) values
  ('a3000000-0000-0000-0000-000000000001', 'Pgtap Uno', 'pgtap-30-uno'),
  ('a3000000-0000-0000-0000-000000000002', 'Pgtap Dos', 'pgtap-30-dos');
insert into public.influencers (id, name, country_code) values ('a3100000-0000-0000-0000-000000000001', 'Influencer Pgtap', 'CO');
insert into public.discount_codes (id, code, country_code, type, value) values
  ('a3200000-0000-0000-0000-000000000001', 'PGTAP30A', 'CO', 'percent', 10),
  ('a3200000-0000-0000-0000-000000000002', 'PGTAP30B', 'CO', 'percent', 10);

insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
                           payment_method, status, subtotal, total_customer, cod_deposit_amount, cod_collect_amount,
                           shipping_city_name, shipping_region_name, discount_code_id, influencer_id, utm, click_ids,
                           created_at, paid_at) values
  -- A: prepago entregado, Medellín, código A, influencer.
  ('a3300000-0000-0000-0000-00000000000a', 'PGTAP30-A', 'CO', 'COP', 'A', 'A', '+573000000001', 'wompi', 'entregado', 100000, 100000, 0, 0,
   'Medellín', 'Antioquia', 'a3200000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001',
   '{"utm_source":" Facebook ","utm_medium":"CPC"}', '{}', '2020-03-10 14:00Z', '2020-03-10 15:00Z'),
  -- B: contra entrega devuelta (ingreso = abono), Medellín, código A.
  ('a3300000-0000-0000-0000-00000000000b', 'PGTAP30-B', 'CO', 'COP', 'B', 'B', '+573000000002', 'cod', 'devuelto', 100000, 100000, 20000, 80000,
   'Medellín', 'Antioquia', 'a3200000-0000-0000-0000-000000000001', null, '{"source":"ig"}', '{}', '2020-03-11 14:00Z', '2020-03-11 15:00Z'),
  -- C: contra entrega entregada, Bogotá, código B (se borrará: queda el texto).
  ('a3300000-0000-0000-0000-00000000000c', 'PGTAP30-C', 'CO', 'COP', 'C', 'C', '+573000000003', 'cod', 'entregado', 50000, 50000, 10000, 40000,
   'Bogotá', 'Bogotá D.C.', 'a3200000-0000-0000-0000-000000000002', null, '{}', '{"fbclid":"abc"}', '2020-03-12 14:00Z', '2020-03-12 15:00Z'),
  -- D: sin pagar (cuenta en pedidos, no en pagados ni ventas).
  ('a3300000-0000-0000-0000-00000000000d', 'PGTAP30-D', 'CO', 'COP', 'D', 'D', '+573000000004', 'wompi', 'pendiente_pago', 70000, 70000, 0, 0,
   'Medellín', 'Antioquia', 'a3200000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001',
   '{}', '{"gclid":"g"}', '2020-03-15 14:00Z', null),
  -- E: pagado el 29-feb 23:59 en Bogotá (04:59 UTC del 1-mar): fuera del rango.
  ('a3300000-0000-0000-0000-00000000000e', 'PGTAP30-E', 'CO', 'COP', 'E', 'E', '+573000000005', 'wompi', 'entregado', 90000, 90000, 0, 0,
   'Medellín', 'Antioquia', null, null, '{}', '{}', '2020-02-28 14:00Z', '2020-03-01 04:59Z'),
  -- F: pagado el 31-mar 23:59 en Bogotá (04:59 UTC del 1-abr): dentro; sin ciudad.
  ('a3300000-0000-0000-0000-00000000000f', 'PGTAP30-F', 'CO', 'COP', 'F', 'F', '+573000000006', 'wompi', 'pagado', 30000, 30000, 0, 0,
   null, null, null, null, '{}', '{"ttclid":"t"}', '2020-03-31 14:00Z', '2020-04-01 04:59Z'),
  -- G: Ecuador y H: Colombia en USD: nunca entran al top de CO.
  ('a3300000-0000-0000-0000-000000000010', 'PGTAP30-G', 'EC', 'USD', 'G', 'G', '+593900000001', 'wompi', 'entregado', 5000, 5000, 0, 0,
   'Quito', 'Pichincha', null, null, '{}', '{}', '2020-03-10 14:00Z', '2020-03-10 15:00Z'),
  ('a3300000-0000-0000-0000-000000000011', 'PGTAP30-H', 'CO', 'USD', 'H', 'H', '+573000000008', 'wompi', 'entregado', 5000, 5000, 0, 0,
   'Medellín', 'Antioquia', null, null, '{}', '{}', '2020-03-10 14:00Z', '2020-03-10 15:00Z');

insert into public.order_items (order_id, product_id, sku, name_snapshot, quantity, unit_price, unit_cost, line_discount) values
  ('a3300000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001', 'P1', 'Uno viejo', 2, 40000, 15000, 0),
  ('a3300000-0000-0000-0000-00000000000a', null, 'SINP', 'Línea sin producto', 1, 20000, null, 0),
  ('a3300000-0000-0000-0000-00000000000b', 'a3000000-0000-0000-0000-000000000001', 'P1', 'Uno', 1, 100000, 30000, 0),
  ('a3300000-0000-0000-0000-00000000000c', 'a3000000-0000-0000-0000-000000000002', 'P2', 'Dos', 1, 50000, 20000, 5000),
  ('a3300000-0000-0000-0000-00000000000d', 'a3000000-0000-0000-0000-000000000002', 'P2', 'Dos', 1, 70000, 20000, 0),
  ('a3300000-0000-0000-0000-00000000000e', 'a3000000-0000-0000-0000-000000000002', 'P2', 'Dos', 1, 90000, 20000, 0),
  ('a3300000-0000-0000-0000-00000000000f', 'a3000000-0000-0000-0000-000000000001', 'P1', 'Uno', 1, 30000, 15000, 0);

insert into public.shipments (order_id, provider, external_order_id, provider_status_name, provider_status_parent, has_novelty) values
  ('a3300000-0000-0000-0000-00000000000a', 'mastershop', 'PGTAP30-A', 'Entregada', 'Finalizadas', false),
  ('a3300000-0000-0000-0000-00000000000b', 'mastershop', 'PGTAP30-B', 'Devuelta', 'Finalizadas', true),
  ('a3300000-0000-0000-0000-00000000000c', 'mastershop', 'PGTAP30-C', 'Entregada', 'Finalizadas', false),
  ('a3300000-0000-0000-0000-00000000000f', 'mastershop', 'PGTAP30-F', 'Por recoger', 'Por preparar', false);

-- El código B se borra: discount_code_id queda null y el texto se conserva.
delete from public.discount_codes where id = 'a3200000-0000-0000-0000-000000000002';

select is((select sale_source from public.orders where id = 'a3300000-0000-0000-0000-00000000000a'), 'facebook / cpc', 'sale_source se calcula al insertar');
update public.orders set utm = '{"utm_source":"Instagram"}' where id = 'a3300000-0000-0000-0000-00000000000e';
select is((select sale_source from public.orders where id = 'a3300000-0000-0000-0000-00000000000e'), 'instagram', 'sale_source se recalcula al actualizar utm');

-- ---------------------------------------------------------------------------------------------------------
-- Validación de parámetros
-- ---------------------------------------------------------------------------------------------------------
select throws_ok($$ select * from public.metricas_top_ciudades('XX', '2020-03-01', '2020-03-31') $$, '22023', null, 'país inválido -> 22023');
select throws_ok($$ select * from public.metricas_top_ciudades('CO', '2020-03-31', '2020-03-01') $$, '22023', null, 'rango invertido -> 22023');
select throws_ok($$ select * from public.metricas_top_productos('CO', '2018-01-01', '2020-03-31') $$, '22023', null, 'rango mayor a 731 días -> 22023');
select throws_ok($$ select * from public.metricas_top_departamentos('CO', '2020-03-01', '2020-03-31', 0) $$, '22023', null, 'límite 0 -> 22023');
select throws_ok($$ select * from public.metricas_top_agrupado('CO', '2020-03-01', '2020-03-31', 'otra') $$, '22023', null, 'dimensión inválida -> 22023');
select throws_ok($$ select * from public.metricas_panel_guias('CO', null, '2020-03-31') $$, '22023', null, 'fecha nula -> 22023');

-- ---------------------------------------------------------------------------------------------------------
-- Ciudades y departamentos (pagados A, B, C, F)
-- ---------------------------------------------------------------------------------------------------------
select results_eq(
  $$ select ciudad, departamento, pedidos, ventas_brutas, entregados, devueltos
       from public.metricas_top_ciudades('CO', '2020-03-01', '2020-03-31') $$,
  $$ values ('Medellín'::text, 'Antioquia'::text, 2, 200000::bigint, 1, 1),
            ('Bogotá', 'Bogotá D.C.', 1, 50000::bigint, 1, 0),
            (null, null, 1, 30000::bigint, 0, 0) $$,
  'top de ciudades: solo pagados del periodo de Bogotá, del país y su moneda; ordenado por ventas');
select is((select count(*)::int from public.metricas_top_ciudades('CO', '2020-03-01', '2020-03-31', 1)), 1, 'p_limite recorta');
select results_eq(
  $$ select departamento, pedidos, ventas_brutas, entregados, devueltos
       from public.metricas_top_departamentos('CO', '2020-03-01', '2020-03-31') $$,
  $$ values ('Antioquia'::text, 2, 200000::bigint, 1, 1), ('Bogotá D.C.', 1, 50000::bigint, 1, 0), (null, 1, 30000::bigint, 0, 0) $$,
  'top de departamentos');
select results_eq(
  $$ select ciudad, pedidos from public.metricas_top_ciudades('EC', '2020-03-01', '2020-03-31') $$,
  $$ values ('Quito'::text, 1) $$,
  'Ecuador solo ve sus pedidos');
select is((select count(*)::int from public.metricas_top_ciudades('CO', '2020-02-29', '2020-02-29')), 1,
          'el 29-feb de Bogotá contiene el pedido pagado a las 04:59 UTC del 1-mar');

-- ---------------------------------------------------------------------------------------------------------
-- Productos con utilidad (pagados y no devueltos: A, C, F)
-- ---------------------------------------------------------------------------------------------------------
select results_eq(
  $$ select producto_id, sku, nombre, unidades, ventas, costo, utilidad, unidades_sin_costo
       from public.metricas_top_productos('CO', '2020-03-01', '2020-03-31') $$,
  $$ values ('a3000000-0000-0000-0000-000000000001'::uuid, 'P1'::text, 'Pgtap Uno'::text, 3, 110000::bigint, 45000::bigint, 65000::bigint, 0),
            ('a3000000-0000-0000-0000-000000000002'::uuid, 'P2', 'Pgtap Dos', 1, 45000::bigint, 20000::bigint, 25000::bigint, 0),
            (null, 'SINP', 'Línea sin producto', 1, 20000::bigint, 0::bigint, 20000::bigint, 1) $$,
  'top de productos: ventas netas del descuento de línea, costo, utilidad, sin costo y nombre actual');

-- ---------------------------------------------------------------------------------------------------------
-- Códigos, influencers y fuentes (todos los pedidos del periodo: A, B, C, D, F)
-- ---------------------------------------------------------------------------------------------------------
select results_eq(
  $$ select clave, etiqueta, pedidos, pagados, ventas_brutas, ingresos_confirmados
       from public.metricas_top_agrupado('CO', '2020-03-01', '2020-03-31', 'codigo') $$,
  $$ values ('a3200000-0000-0000-0000-000000000001'::text, 'PGTAP30A'::text, 3, 2, 200000::bigint, 120000::bigint),
            ('texto:PGTAP30B', 'PGTAP30B', 1, 1, 50000::bigint, 50000::bigint) $$,
  'top de códigos: ingreso confirmado de contra entrega devuelta = abono; código borrado por su texto');
select results_eq(
  $$ select clave, etiqueta, pedidos, pagados, ventas_brutas, ingresos_confirmados
       from public.metricas_top_agrupado('CO', '2020-03-01', '2020-03-31', 'influencer') $$,
  $$ values ('a3100000-0000-0000-0000-000000000001'::text, 'Influencer Pgtap'::text, 2, 1, 100000::bigint, 100000::bigint) $$,
  'top de influencers');
select results_eq(
  $$ select clave, etiqueta, pedidos, pagados, ventas_brutas, ingresos_confirmados
       from public.metricas_top_agrupado('CO', '2020-03-01', '2020-03-31', 'fuente') $$,
  $$ values ('facebook / cpc'::text, 'facebook / cpc'::text, 1, 1, 100000::bigint, 100000::bigint),
            ('ig', 'ig', 1, 1, 100000::bigint, 20000::bigint),
            ('meta (clic de anuncio)', 'meta (clic de anuncio)', 1, 1, 50000::bigint, 50000::bigint),
            ('tiktok (clic de anuncio)', 'tiktok (clic de anuncio)', 1, 1, 30000::bigint, 0::bigint),
            ('google (clic de anuncio)', 'google (clic de anuncio)', 1, 0, 0::bigint, 0::bigint) $$,
  'top de fuentes (UTM y click IDs)');
select is((select count(*)::int from public.metricas_top_agrupado('CO', '2020-03-01', '2020-03-31', 'fuente', 2)), 2, 'p_limite en agrupado');

-- ---------------------------------------------------------------------------------------------------------
-- Panel por estado de guía
-- ---------------------------------------------------------------------------------------------------------
select set_eq(
  $$ select estado, cantidad from public.metricas_panel_guias('CO', '2020-03-01', '2020-03-31') where dimension = 'estado_pedido' $$,
  $$ values ('entregado'::text, 2), ('devuelto', 1), ('pendiente_pago', 1), ('pagado', 1) $$,
  'panel: conteo por estado del pedido');
select set_eq(
  $$ select estado, grupo, cantidad from public.metricas_panel_guias('CO', '2020-03-01', '2020-03-31') where dimension = 'estado_guia' $$,
  $$ values ('Entregada'::text, 'Finalizadas'::text, 2), ('Devuelta', 'Finalizadas', 1), ('Por recoger', 'Por preparar', 1) $$,
  'panel: conteo por estado de MasterShop con su grupo');
select set_eq(
  $$ select grupo, cantidad from public.metricas_panel_guias('CO', '2020-03-01', '2020-03-31') where dimension = 'grupo_guia' $$,
  $$ values ('Finalizadas'::text, 3), ('Por preparar', 1) $$,
  'panel: conteo por grupo');
select is((select cantidad from public.metricas_panel_guias('CO', '2020-03-01', '2020-03-31') where dimension = 'novedad'), 1,
          'panel: pedidos con novedad');
select is((select cantidad from public.metricas_panel_guias('CO', '2019-03-01', '2019-03-31') where dimension = 'novedad'), 0,
          'panel: la fila de novedad existe aunque no haya pedidos');
select is((select count(*)::int from public.metricas_panel_guias('CO', '2019-03-01', '2019-03-31')), 1,
          'panel sin pedidos: solo la fila de novedad');

-- Sin pedidos en el periodo: tops vacíos.
select is_empty($$ select * from public.metricas_top_productos('CO', '2019-03-01', '2019-03-31') $$, 'productos: vacío sin pedidos');
select is_empty($$ select * from public.metricas_top_agrupado('CO', '2019-03-01', '2019-03-31', 'codigo') $$, 'códigos: vacío sin pedidos');

-- RLS de las tablas leídas sigue activo.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.orders'::regclass, 'public.order_items'::regclass,
           'public.shipments'::regclass, 'public.media'::regclass)), 'RLS activo en orders, order_items, shipments y media');

select * from finish();
rollback;
