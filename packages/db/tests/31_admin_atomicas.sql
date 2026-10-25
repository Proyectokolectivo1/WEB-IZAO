-- Pruebas pgtap · RPC atómicas del panel: anonimizar_cliente, cancelar_pedido, admin_publicar_pagina y rating de
-- catalog_listing al moderar reseñas.
begin;
set local search_path = public, extensions;
select plan(52);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;

-- Producto visible en CO con stock (para deseos, cancelación y reseñas).
insert into public.products (id, name, slug, status) values ('b3100000-0000-0000-0000-000000000001', 'Pgtap Treinta y uno', 'pgtap-31', 'active');
insert into public.product_countries (product_id, country_code, is_visible, published_at)
  values ('b3100000-0000-0000-0000-000000000001', 'CO', true, '2026-10-01');
insert into public.product_variants (id, product_id, sku, is_default)
  values ('b3110000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 'PG31-100', true);
insert into public.variant_countries (variant_id, country_code, price, stock)
  values ('b3110000-0000-0000-0000-000000000001', 'CO', 100000, 10);

-- ---------------------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.anonimizar_cliente(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.anonimizar_cliente(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.anonimizar_cliente(uuid)', 'execute'),
          'anonimizar_cliente: solo service_role');
select ok(not has_function_privilege('anon', 'public.cancelar_pedido(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.cancelar_pedido(jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.cancelar_pedido(jsonb)', 'execute'),
          'cancelar_pedido: solo service_role');
select ok(not has_function_privilege('anon', 'public.admin_publicar_pagina(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.admin_publicar_pagina(jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.admin_publicar_pagina(jsonb)', 'execute'),
          'admin_publicar_pagina: solo service_role');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.anonimizar_cliente(uuid)'::regprocedure),
          'anonimizar_cliente: security definer con search_path vacío');

-- ---------------------------------------------------------------------------------------------------------
-- 1) anonimizar_cliente
-- ---------------------------------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('b3200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pgtap31-k1@example.com'),
  ('b3200000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'pgtap31-k4@example.com');
insert into public.admin_users (auth_user_id, role, name) values ('b3200000-0000-0000-0000-000000000004', 'operator', 'Pgtap');
insert into public.customers (id, auth_user_id, country_code, first_name, last_name, email, phone_e164, document_type, document_number, marketing_opt_in) values
  ('b3300000-0000-0000-0000-000000000001', 'b3200000-0000-0000-0000-000000000001', 'CO', 'Karla', 'Uno', 'pgtap31-k1@example.com', '+573001110001', 'CC', '111', true),
  ('b3300000-0000-0000-0000-000000000002', null, 'CO', 'Kevin', 'Dos', 'pgtap31-k2@example.com', '+573001110002', null, null, false),
  ('b3300000-0000-0000-0000-000000000003', null, 'CO', 'Kiara', 'Tres', 'pgtap31-k3@example.com', '+573001110003', null, null, false),
  ('b3300000-0000-0000-0000-000000000004', 'b3200000-0000-0000-0000-000000000004', 'CO', 'Kai', 'Cuatro', 'pgtap31-k4@example.com', '+573001110004', null, null, false);

insert into public.orders (id, number, country_code, currency_code, customer_id, contact_first_name, contact_last_name, contact_phone_e164,
                           contact_email, document_type, document_number, shipping_city_name, shipping_region_name, shipping_address1,
                           shipping_notes, payment_method, status, subtotal, total_customer, created_at) values
  ('b3400000-0000-0000-0000-000000000001', 'PGTAP31-1', 'CO', 'COP', 'b3300000-0000-0000-0000-000000000001', 'Karla', 'Uno', '+573001110001',
   'pgtap31-k1@example.com', 'CC', '111', 'Medellín', 'Antioquia', 'Calle 1 # 2-3', 'Portería', 'wompi', 'entregado', 90000, 90000, '2026-01-10'),
  -- Pedido de invitado con el mismo correo.
  ('b3400000-0000-0000-0000-000000000002', 'PGTAP31-2', 'CO', 'COP', null, 'Karla', 'U', '+573009999999',
   'pgtap31-k1@example.com', null, null, 'Envigado', 'Antioquia', 'Carrera 4', null, 'wompi', 'cancelado', 50000, 50000, '2026-02-10'),
  -- De otra persona: no se toca.
  ('b3400000-0000-0000-0000-000000000003', 'PGTAP31-3', 'CO', 'COP', null, 'Otra', 'Persona', '+573008888888',
   'pgtap31-otra@example.com', null, null, 'Cali', 'Valle', 'Calle 9', null, 'wompi', 'entregado', 70000, 70000, '2026-02-11'),
  -- En curso para K2.
  ('b3400000-0000-0000-0000-000000000004', 'PGTAP31-4', 'CO', 'COP', 'b3300000-0000-0000-0000-000000000002', 'Kevin', 'Dos', '+573001110002',
   null, null, null, 'Bogotá', 'Bogotá D.C.', 'Calle 5', null, 'wompi', 'pagado', 60000, 60000, '2026-03-01');

insert into public.whatsapp_messages (order_id, to_e164, status) values ('b3400000-0000-0000-0000-000000000001', '+573001110001', 'sent');
insert into public.warranty_claims (number, order_id, country_code, customer_name, phone, email, reason, description, status) values
  ('PGT31-G1', 'b3400000-0000-0000-0000-000000000001', 'CO', 'Karla Uno', '+573001110001', 'pgtap31-k1@example.com', 'otro', 'Llegó roto', 'resuelta'),
  ('PGT31-G3', null, 'CO', 'Kiara Tres', '+573001110003', null, 'otro', 'Abierta', 'en_revision');
insert into public.leads (country_code, email, phone_e164, consent_at, consent_text_version, converted_order_id) values
  ('CO', null, '+573001110001', now(), 'v1', null),
  ('CO', 'pgtap31-lead@example.com', null, now(), 'v1', 'b3400000-0000-0000-0000-000000000001');
insert into public.addresses (customer_id, address1) values ('b3300000-0000-0000-0000-000000000001', 'Calle 1 # 2-3');
insert into public.wishlists (customer_id, product_id) values ('b3300000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001');
insert into public.chat_sessions (id, country_code, visitor_id, customer_id, converted_order_id) values
  ('b3500000-0000-0000-0000-000000000001', 'CO', 'v-pgtap31-1', 'b3300000-0000-0000-0000-000000000001', null),
  ('b3500000-0000-0000-0000-000000000002', 'CO', 'v-pgtap31-2', null, 'b3400000-0000-0000-0000-000000000002');
insert into public.chat_messages (session_id, role, content) values
  ('b3500000-0000-0000-0000-000000000001', 'user', 'Mi dirección es Calle 1'),
  ('b3500000-0000-0000-0000-000000000002', 'user', 'Hola');

select is(public.anonimizar_cliente(null) ->> 'motivo', 'datos_invalidos', 'id nulo: datos_invalidos');
select is(public.anonimizar_cliente('b33fffff-0000-0000-0000-000000000000') ->> 'motivo', 'no_existe', 'cliente inexistente: no_existe');
select is(public.anonimizar_cliente('b3300000-0000-0000-0000-000000000002'),
          '{"ok": false, "motivo": "bloqueado", "cuenta_del_panel": false, "pedidos_en_curso": 1, "garantias_abiertas": 0}'::jsonb,
          'pedido en curso: bloqueado');
select is(public.anonimizar_cliente('b3300000-0000-0000-0000-000000000003') ->> 'garantias_abiertas', '1', 'garantía abierta (por celular): bloqueado');
select is(public.anonimizar_cliente('b3300000-0000-0000-0000-000000000004') ->> 'cuenta_del_panel', 'true', 'cuenta del panel: bloqueado');
select is((select first_name from public.customers where id = 'b3300000-0000-0000-0000-000000000002'), 'Kevin', 'un bloqueo no toca nada');

select is(public.anonimizar_cliente('b3300000-0000-0000-0000-000000000001') - 'id',
          '{"ok": true, "estado": "anonimizado", "pedidos": 2, "mensajes_whatsapp": 1, "garantias": 1, "leads": 2, "direcciones": 1,
            "deseos": 1, "conversaciones": 2, "cuenta_acceso_eliminada": true}'::jsonb,
          'anonimiza pedidos, mensajes, garantías, leads, direcciones, deseos, conversaciones y cuenta');
select ok((select first_name is null and last_name is null and email is null and phone_e164 is null and document_number is null
                  and not marketing_opt_in and auth_user_id is null and anonymized_at is not null
             from public.customers where id = 'b3300000-0000-0000-0000-000000000001'), 'ficha neutralizada y marcada');
select results_eq(
  $$ select contact_first_name, contact_last_name, contact_phone_e164, contact_email::text, document_number, shipping_address1, shipping_notes,
            status, total_customer, shipping_city_name, shipping_region_name, created_at::date, customer_id
       from public.orders where id = 'b3400000-0000-0000-0000-000000000001' $$,
  $$ values ('Anonimizado'::text, ''::text, 'anonimizado'::text, null::text, null::text, null::text, null::text,
             'entregado'::text, 90000::bigint, 'Medellín'::text, 'Antioquia'::text, '2026-01-10'::date, 'b3300000-0000-0000-0000-000000000001'::uuid) $$,
  'pedido: sin datos personales; conserva estado, monto, fecha, ciudad y departamento');
select is((select contact_first_name || '|' || coalesce(contact_email::text, '-') from public.orders where id = 'b3400000-0000-0000-0000-000000000002'),
          'Anonimizado|-', 'pedido de invitado con el mismo correo: anonimizado');
select is((select contact_first_name || '|' || contact_phone_e164 from public.orders where id = 'b3400000-0000-0000-0000-000000000003'),
          'Otra|+573008888888', 'pedido de otra persona intacto');
select is((select to_e164 from public.whatsapp_messages where order_id = 'b3400000-0000-0000-0000-000000000001'), 'anonimizado', 'mensaje de WhatsApp neutralizado');
select results_eq($$ select customer_name, phone, email::text, description, status from public.warranty_claims where number = 'PGT31-G1' $$,
                  $$ values ('Anonimizado'::text, 'anonimizado'::text, null::text, null::text, 'resuelta'::text) $$, 'garantía neutralizada, conserva estado');
select is((select count(*)::int from public.leads where phone_e164 = '+573001110001' or converted_order_id = 'b3400000-0000-0000-0000-000000000001'), 0, 'leads borrados');
select ok(not exists (select 1 from public.addresses where customer_id = 'b3300000-0000-0000-0000-000000000001')
          and not exists (select 1 from public.wishlists where customer_id = 'b3300000-0000-0000-0000-000000000001'), 'direcciones y deseos borrados');
select ok(not exists (select 1 from public.chat_sessions where id in ('b3500000-0000-0000-0000-000000000001', 'b3500000-0000-0000-0000-000000000002'))
          and not exists (select 1 from public.chat_messages where session_id in ('b3500000-0000-0000-0000-000000000001', 'b3500000-0000-0000-0000-000000000002')),
          'conversaciones con Iza y sus mensajes borrados');
select ok(not exists (select 1 from auth.users where id = 'b3200000-0000-0000-0000-000000000001'), 'cuenta de acceso eliminada');
select is(public.anonimizar_cliente('b3300000-0000-0000-0000-000000000001') ->> 'motivo', 'ya_anonimizado', 'segunda vez: ya_anonimizado');

-- ---------------------------------------------------------------------------------------------------------
-- 2) cancelar_pedido
-- ---------------------------------------------------------------------------------------------------------
insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
                           payment_method, status, subtotal, total_customer) values
  ('b3600000-0000-0000-0000-000000000001', 'PGTAP31-C1', 'CO', 'COP', 'C', 'Uno', '+573002220001', 'manual', 'pendiente_manual', 200000, 200000),
  ('b3600000-0000-0000-0000-000000000002', 'PGTAP31-C2', 'CO', 'COP', 'C', 'Dos', '+573002220002', 'wompi', 'en_preparacion', 100000, 100000),
  ('b3600000-0000-0000-0000-000000000003', 'PGTAP31-C3', 'CO', 'COP', 'C', 'Tres', '+573002220003', 'wompi', 'en_transito', 100000, 100000);
insert into public.order_items (order_id, product_id, variant_id, sku, name_snapshot, quantity, unit_price) values
  ('b3600000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 'b3110000-0000-0000-0000-000000000001', 'PG31-100', 'Pgtap', 2, 100000),
  ('b3600000-0000-0000-0000-000000000002', 'b3100000-0000-0000-0000-000000000001', 'b3110000-0000-0000-0000-000000000001', 'PG31-100', 'Pgtap', 1, 100000);
select is(public.reservar_stock('b3600000-0000-0000-0000-000000000001') ->> 'ok', 'true', 'reserva de C1');
update public.orders set stock_state = 'confirmed' where id = 'b3600000-0000-0000-0000-000000000002';

select is(public.cancelar_pedido('{"order_id":"b3600000-0000-0000-0000-000000000003","from_status":"en_transito","actor":"admin:x"}') ->> 'motivo',
          'transicion_invalida', 'en_transito no se cancela (order-state)');
select is(public.cancelar_pedido('{"order_id":"b3600000-0000-0000-0000-000000000001","from_status":"requiere_reembolso","actor":"admin:x"}'),
          '{"ok": false, "motivo": "estado_cambiado", "status_actual": "pendiente_manual"}'::jsonb, 'from_status distinto del actual: estado_cambiado');
select is(public.cancelar_pedido('{"order_id":"b3600000-0000-0000-0000-000000000001","from_status":"pendiente_manual"}') ->> 'motivo',
          'datos_invalidos', 'sin actor: datos_invalidos');
select is(public.cancelar_pedido('{"order_id":"no-uuid","from_status":"pendiente_manual","actor":"admin:x"}') ->> 'motivo',
          'datos_invalidos', 'order_id inválido: datos_invalidos');
select is(public.cancelar_pedido('{"order_id":"b36fffff-0000-0000-0000-000000000000","from_status":"pendiente_manual","actor":"admin:x"}') ->> 'motivo',
          'pedido_inexistente', 'pedido inexistente');
select is((select stock_reserved from public.variant_countries where variant_id = 'b3110000-0000-0000-0000-000000000001'), 2, 'nada cambió tras los rechazos');

select is(public.cancelar_pedido('{"order_id":"b3600000-0000-0000-0000-000000000001","from_status":"pendiente_manual","actor":"admin:b3200000","motivo":"Cliente desistió"}')
            - 'event_id',
          '{"ok": true, "order_id": "b3600000-0000-0000-0000-000000000001", "from_status": "pendiente_manual", "to_status": "cancelado",
            "stock_estado": "released", "stock_liberado": true}'::jsonb,
          'cancela y libera la reserva');
select ok((select status = 'cancelado' and cancelled_at is not null and stock_state = 'released' from public.orders where id = 'b3600000-0000-0000-0000-000000000001'),
          'pedido cancelado con fecha y stock liberado');
select results_eq($$ select stock, stock_reserved from public.variant_countries where variant_id = 'b3110000-0000-0000-0000-000000000001' $$,
                  $$ values (10, 0) $$, 'la reserva vuelve al disponible');
select is((select payload ->> 'motivo' from public.order_events where order_id = 'b3600000-0000-0000-0000-000000000001' and to_status = 'cancelado'),
          'Cliente desistió', 'evento status_changed con el motivo');
select is(public.cancelar_pedido('{"order_id":"b3600000-0000-0000-0000-000000000002","from_status":"en_preparacion","actor":"webhook:mastershop"}')
            ->> 'stock_estado', 'confirmed', 'pagado y confirmado: cancela sin devolver el stock descontado');
select is((select stock from public.variant_countries where variant_id = 'b3110000-0000-0000-0000-000000000001'), 10, 'stock sin cambios en C2');

-- ---------------------------------------------------------------------------------------------------------
-- 3) admin_publicar_pagina
-- ---------------------------------------------------------------------------------------------------------
-- Aisla CO/envios de lo sembrado (se revierte al final).
update public.pages set status = 'draft' where country_code = 'CO' and kind = 'envios' and status = 'published';
insert into public.pages (id, country_code, kind, slug, title, content_html, status, version) values
  ('b3700000-0000-0000-0000-000000000001', 'CO', 'envios', 'pgtap31-envios-viejo', 'Envíos viejo', '<p>viejo</p>', 'published', 4);

select is(public.admin_publicar_pagina('{"country_code":"CO","kind":"envios","slug":"pgtap31-envios","title":"Envíos","content_html":"<p>a</p>","status":"draft"}')
            - 'id',
          '{"ok": true, "estado": "creada", "version": 1, "status": "draft", "publicada_ahora": false, "despublicada": null, "antes": null}'::jsonb,
          'crea en borrador con versión 1');
select ok((select status = 'published' from public.pages where id = 'b3700000-0000-0000-0000-000000000001'), 'un borrador no despublica la vigente');

select is((select jsonb_build_object('version', r -> 'version', 'publicada_ahora', r -> 'publicada_ahora', 'despublicada', r -> 'despublicada')
             from (select public.admin_publicar_pagina(jsonb_build_object('id', id, 'country_code', 'CO', 'kind', 'envios', 'slug', 'pgtap31-envios',
                            'title', 'Envíos', 'content_html', '<p>a</p>', 'status', 'published')) r
                     from public.pages where slug = 'pgtap31-envios') x),
          '{"version": 2, "publicada_ahora": true, "despublicada": {"id": "b3700000-0000-0000-0000-000000000001", "title": "Envíos viejo", "country_code": "CO"}}'::jsonb,
          'publicar: sube la versión y despublica la anterior en la misma transacción');
select results_eq($$ select status from public.pages where id = 'b3700000-0000-0000-0000-000000000001' $$, $$ values ('draft'::text) $$, 'la anterior quedó en borrador');

select is((select (public.admin_publicar_pagina(jsonb_build_object('id', id, 'country_code', 'CO', 'kind', 'envios', 'slug', 'pgtap31-envios',
             'title', 'Envíos', 'content_html', '<p>a</p>', 'status', 'published', 'seo_title', 'SEO')) ->> 'version')::int
             from public.pages where slug = 'pgtap31-envios'), 2, 'publicada sin cambio de título ni HTML: misma versión');
select is((select (public.admin_publicar_pagina(jsonb_build_object('id', id, 'country_code', 'CO', 'kind', 'envios', 'slug', 'pgtap31-envios',
             'title', 'Envíos', 'content_html', '<p>b</p>', 'status', 'published')) -> 'antes' ->> 'content_length')::int
             from public.pages where slug = 'pgtap31-envios'), 8, 'devuelve el estado anterior (largo del HTML)');
select is((select version from public.pages where slug = 'pgtap31-envios'), 3, 'cambiar el HTML publicado sube la versión');

-- Publicar la vieja con marcadores: falla y la vigente sigue publicada (la despublicación se deshace).
select is(public.admin_publicar_pagina('{"id":"b3700000-0000-0000-0000-000000000001","country_code":"CO","kind":"envios","slug":"pgtap31-envios-viejo","title":"Envíos viejo","content_html":"<p>[COMPLETAR]</p>","status":"published"}')
            ->> 'motivo', 'marcadores_pendientes', 'marcadores sin resolver: marcadores_pendientes');
select is((select status from public.pages where slug = 'pgtap31-envios'), 'published', 'tras el fallo, la vigente sigue publicada');
select is(public.admin_publicar_pagina('{"country_code":"CO","kind":"general","slug":"pgtap31-envios","title":"X","content_html":"<p>x</p>","status":"draft"}')
            ->> 'motivo', 'slug_duplicado', 'slug repetido en el país: slug_duplicado');
select is(public.admin_publicar_pagina('{"id":"b37fffff-0000-0000-0000-000000000000","country_code":"CO","kind":"general","slug":"pgtap31-x","title":"X","content_html":"<p>x</p>","status":"draft"}')
            ->> 'motivo', 'no_existe', 'id inexistente: no_existe');
select is(public.admin_publicar_pagina('{"country_code":"CO","kind":"general","slug":"pgtap31-y","content_html":"<p>x</p>","status":"draft"}')
            ->> 'motivo', 'datos_invalidos', 'sin título: datos_invalidos');
select is(public.admin_publicar_pagina('{"country_code":"CO","kind":"otro","slug":"pgtap31-z","title":"Z","content_html":"<p>x</p>","status":"draft"}')
            ->> 'detalle', 'pages_kind_check', 'tipo desconocido: datos_invalidos con el constraint');
select is((select (public.admin_publicar_pagina(jsonb_build_object('id', id, 'country_code', 'CO', 'kind', 'envios', 'slug', 'pgtap31-envios',
             'title', 'Envíos', 'content_html', '<p>c</p>', 'status', 'draft')) ->> 'version')::int
             from public.pages where slug = 'pgtap31-envios'), 3, 'pasar a borrador conserva la versión');

-- ---------------------------------------------------------------------------------------------------------
-- 4) rating de catalog_listing al moderar
-- ---------------------------------------------------------------------------------------------------------
insert into public.reviews (id, country_code, product_id, author_name, rating, status) values
  ('b3800000-0000-0000-0000-000000000001', 'CO', 'b3100000-0000-0000-0000-000000000001', 'A', 4, 'pending');
select results_eq($$ select rating_avg, rating_count from public.catalog_listing where product_id = 'b3100000-0000-0000-0000-000000000001' and country_code = 'CO' $$,
                  $$ values (null::numeric, 0) $$, 'reseña pendiente: no cuenta');
update public.reviews set status = 'approved' where id = 'b3800000-0000-0000-0000-000000000001';
select results_eq($$ select rating_avg, rating_count from public.catalog_listing where product_id = 'b3100000-0000-0000-0000-000000000001' and country_code = 'CO' $$,
                  $$ values (4.00::numeric, 1) $$, 'aprobar recalcula rating_avg y rating_count');
update public.reviews set status = 'rejected' where id = 'b3800000-0000-0000-0000-000000000001';
select results_eq($$ select rating_avg, rating_count from public.catalog_listing where product_id = 'b3100000-0000-0000-0000-000000000001' and country_code = 'CO' $$,
                  $$ values (null::numeric, 0) $$, 'rechazar una aprobada la saca del rating');

select * from finish();
rollback;
