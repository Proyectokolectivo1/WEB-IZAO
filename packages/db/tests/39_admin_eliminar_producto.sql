-- Pruebas pgtap · admin_eliminar_producto (D-055): archiva con pedidos, borra en cascada sin pedidos,
-- cuida las imágenes compartidas, limpia códigos de descuento, no deja huérfanos y queda solo para service_role.
begin;
set local search_path = public, extensions;
select plan(25);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0'), ('USD', 2, '$', '$ #.##0,00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values
  ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57'), ('EC', 'Ecuador', 'USD', 'es-EC', 'America/Guayaquil', '+593') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO'), ('EC') on conflict do nothing;

-- Imágenes: una propia del producto A, una compartida entre A y B, una propia de la variante de A.
insert into public.media (id, kind, base_path, variants, alt) values
  ('e3900000-0000-0000-0000-000000000001', 'product', 'product/pg39/propia', '{"400":"p-400.webp"}', 'propia'),
  ('e3900000-0000-0000-0000-000000000002', 'product', 'product/pg39/compartida', '{"400":"c-400.webp"}', 'compartida'),
  ('e3900000-0000-0000-0000-000000000003', 'product', 'product/pg39/variante', '{"400":"v-400.webp"}', 'variante');

-- A: sin pedidos. B: con un pedido. C: archivado y con pedido.
insert into public.products (id, name, slug, status) values
  ('c3900000-0000-0000-0000-00000000000a', 'Eliminar A', 'pg39-a', 'active'),
  ('c3900000-0000-0000-0000-00000000000b', 'Eliminar B', 'pg39-b', 'active'),
  ('c3900000-0000-0000-0000-00000000000c', 'Eliminar C', 'pg39-c', 'archived');
insert into public.product_countries (product_id, country_code, is_visible) values
  ('c3900000-0000-0000-0000-00000000000a', 'CO', true), ('c3900000-0000-0000-0000-00000000000a', 'EC', true),
  ('c3900000-0000-0000-0000-00000000000b', 'CO', true);
insert into public.product_variants (id, product_id, sku, is_default, mastershop_product_id, mastershop_variant_id, image_id) values
  ('c3910000-0000-0000-0000-00000000000a', 'c3900000-0000-0000-0000-00000000000a', 'PG39-A', true, 9001, 9002, 'e3900000-0000-0000-0000-000000000003'),
  ('c3910000-0000-0000-0000-00000000000b', 'c3900000-0000-0000-0000-00000000000b', 'PG39-B', true, null, null, null),
  ('c3910000-0000-0000-0000-00000000000c', 'c3900000-0000-0000-0000-00000000000c', 'PG39-C', true, null, null, null);
insert into public.variant_countries (variant_id, country_code, is_active, price, stock, mastershop_product_id, mastershop_variant_id) values
  ('c3910000-0000-0000-0000-00000000000a', 'CO', true, 100000, 5, 9001, 9002),
  ('c3910000-0000-0000-0000-00000000000b', 'CO', true, 120000, 5, null, null);
insert into public.product_images (product_id, media_id, role, sort_order) values
  ('c3900000-0000-0000-0000-00000000000a', 'e3900000-0000-0000-0000-000000000001', 'primary', 0),
  ('c3900000-0000-0000-0000-00000000000a', 'e3900000-0000-0000-0000-000000000002', 'gallery', 1),
  ('c3900000-0000-0000-0000-00000000000b', 'e3900000-0000-0000-0000-000000000002', 'primary', 0);

insert into public.discount_codes (id, code, country_code, type, value, applies_to, target_ids, exclude_ids) values
  ('c3920000-0000-0000-0000-000000000001', 'PG39', 'CO', 'percent', 10, 'products',
   array['c3900000-0000-0000-0000-00000000000a'::uuid, 'c3900000-0000-0000-0000-00000000000b'::uuid],
   array['c3900000-0000-0000-0000-00000000000a'::uuid]);

insert into public.orders (id, number, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164,
                           payment_method, status, subtotal, total_customer) values
  ('c3930000-0000-0000-0000-000000000001', 'PGTAP39-1', 'CO', 'COP', 'C', 'A', '+573005550039', 'wompi', 'entregado', 120000, 120000),
  ('c3930000-0000-0000-0000-000000000002', 'PGTAP39-2', 'CO', 'COP', 'C', 'B', '+573005550040', 'wompi', 'entregado', 100000, 100000);
insert into public.order_items (order_id, product_id, variant_id, sku, name_snapshot, quantity, unit_price) values
  ('c3930000-0000-0000-0000-000000000001', 'c3900000-0000-0000-0000-00000000000b', 'c3910000-0000-0000-0000-00000000000b', 'PG39-B', 'Eliminar B', 1, 120000),
  ('c3930000-0000-0000-0000-000000000002', 'c3900000-0000-0000-0000-00000000000c', 'c3910000-0000-0000-0000-00000000000c', 'PG39-C', 'Eliminar C', 1, 100000);

create temp table r (k text primary key, j jsonb) on commit drop;

select is((select count(*)::int from public.catalog_listing where product_id = 'c3900000-0000-0000-0000-00000000000a'), 2, 'antes: A está en catalog_listing de los dos países');

-- Con pedidos: se archiva, no se borra
insert into r values ('b', public.admin_eliminar_producto('{"product_id":"c3900000-0000-0000-0000-00000000000b"}'::jsonb));
select is((select j ->> 'accion' from r where k = 'b'), 'archivado', 'con pedidos: la acción es archivar');
select is((select (j ->> 'pedidos')::int from r where k = 'b'), 1, 'con pedidos: informa cuántos');
select is((select status from public.products where id = 'c3900000-0000-0000-0000-00000000000b'), 'archived', 'con pedidos: queda archivado');
select is((select count(*)::int from public.product_variants where product_id = 'c3900000-0000-0000-0000-00000000000b'), 1, 'con pedidos: la variante sigue');
select is((select count(*)::int from public.order_items where product_id = 'c3900000-0000-0000-0000-00000000000b' and name_snapshot = 'Eliminar B' and unit_price = 120000), 1, 'con pedidos: el pedido conserva producto y copia');
select is((select is_visible from public.catalog_listing where product_id = 'c3900000-0000-0000-0000-00000000000b' and country_code = 'CO'), false, 'con pedidos: sale de la tienda (is_visible = false)');

-- Ya archivado y con pedidos: idempotente
insert into r values ('c', public.admin_eliminar_producto('{"product_id":"c3900000-0000-0000-0000-00000000000c"}'::jsonb));
select is((select j ->> 'accion' from r where k = 'c'), 'ya_archivado', 'archivado con pedidos: no hace nada más');
insert into r values ('b2', public.admin_eliminar_producto('{"product_id":"c3900000-0000-0000-0000-00000000000b"}'::jsonb));
select is((select j ->> 'accion' from r where k = 'b2'), 'ya_archivado', 'repetir el archivado es idempotente');

-- Sin pedidos: borrado físico en cascada
insert into r values ('a', public.admin_eliminar_producto('{"product_id":"c3900000-0000-0000-0000-00000000000a"}'::jsonb));
select is((select j ->> 'accion' from r where k = 'a'), 'eliminado', 'sin pedidos: se elimina');
select is((select count(*)::int from public.products where id = 'c3900000-0000-0000-0000-00000000000a'), 0, 'sin pedidos: el producto ya no existe');
select is((select count(*)::int from public.product_variants where product_id = 'c3900000-0000-0000-0000-00000000000a'), 0, 'sin pedidos: sin variantes');
select is((select count(*)::int from public.variant_countries where variant_id = 'c3910000-0000-0000-0000-00000000000a'), 0, 'sin pedidos: sin precios ni enlaces MasterShop por país');
select is((select count(*)::int from public.product_countries where product_id = 'c3900000-0000-0000-0000-00000000000a'), 0, 'sin pedidos: sin países');
select is((select count(*)::int from public.product_images where product_id = 'c3900000-0000-0000-0000-00000000000a'), 0, 'sin pedidos: sin imágenes enlazadas');
select is((select count(*)::int from public.catalog_listing where product_id = 'c3900000-0000-0000-0000-00000000000a'), 0, 'sin pedidos: fuera de catalog_listing');

-- Imágenes: la propia y la de la variante se borran y se encolan; la compartida con B se conserva
select is((select count(*)::int from public.media where id in ('e3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000003')), 0, 'imágenes propias: borradas de media');
select is((select count(*)::int from public.media_file_deletions where media_id in ('e3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000003') and reason = 'producto_eliminado'), 2, 'imágenes propias: encoladas para borrar del disco');
select is((select count(*)::int from public.media where id = 'e3900000-0000-0000-0000-000000000002'), 1, 'imagen compartida con otro producto: se conserva');
select is((select count(*)::int from public.product_images where media_id = 'e3900000-0000-0000-0000-000000000002' and product_id = 'c3900000-0000-0000-0000-00000000000b'), 1, 'imagen compartida: B sigue usándola');

-- Códigos de descuento
select is((select target_ids from public.discount_codes where id = 'c3920000-0000-0000-0000-000000000001'),
          array['c3900000-0000-0000-0000-00000000000b'::uuid], 'descuento: se quita el producto de target_ids');
select is((select exclude_ids from public.discount_codes where id = 'c3920000-0000-0000-0000-000000000001'), '{}'::uuid[], 'descuento: se quita el producto de exclude_ids');

-- Errores y permisos
select is((public.admin_eliminar_producto('{"product_id":"c3900000-0000-0000-0000-0000000000ff"}'::jsonb)) ->> 'motivo', 'no_existe', 'producto inexistente: motivo no_existe');
select is((public.admin_eliminar_producto('{"product_id":"no-es-uuid"}'::jsonb)) ->> 'motivo', 'datos_invalidos', 'identificador inválido: datos_invalidos');
select is(has_function_privilege('anon', 'public.admin_eliminar_producto(jsonb)', 'execute')
          or has_function_privilege('authenticated', 'public.admin_eliminar_producto(jsonb)', 'execute'), false, 'solo service_role puede ejecutarla');

select * from finish();
rollback;
