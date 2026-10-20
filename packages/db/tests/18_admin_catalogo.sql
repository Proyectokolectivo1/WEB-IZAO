-- Pruebas pgtap · Oleada 2: admin_guardar_producto y admin_importar_catalogo (contrato en docs/estado/izao-db.md).
begin;
set local search_path = public, extensions;
select plan(26);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0'), ('USD', 2, '$', '$ #.##0,00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values
  ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57'), ('EC', 'Ecuador', 'USD', 'es-EC', 'America/Guayaquil', '+593') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO'), ('EC') on conflict do nothing;
insert into public.brands (id, name, slug) values ('b0000000-0000-0000-0000-0000000018d1', 'Marca Guardar', 'marca-guardar-test');
insert into public.categories (id, name, slug) values ('b0000000-0000-0000-0000-0000000018d4', 'Cat Guardar', 'cat-guardar-test');
insert into public.media (id, kind, base_path, variants, alt) values
  ('e0000000-0000-0000-0000-0000000018e1', 'product', 'product/prueba/guardar', '{"400":"g-400.webp"}', 'frasco');

create temp table r (k text primary key, j jsonb) on commit drop;
create temp table pid (k text primary key, id uuid, pub timestamptz) on commit drop;

-- Alta: precio como string numérico, imagen principal, visible en CO
insert into r values ('alta', public.admin_guardar_producto($j${
  "product": {"name": "Guardar Uno", "slug": "guardar-uno", "brand_id": "b0000000-0000-0000-0000-0000000018d1", "status": "active", "notes_top": ["bergamota"]},
  "category_ids": ["b0000000-0000-0000-0000-0000000018d4"],
  "countries": [{"country_code": "CO", "is_visible": true, "is_featured": false, "featured_rank": null, "badges": ["nuevo"]}],
  "options": [{"id": "a1000000-0000-0000-0000-000000000018", "name": "Presentación", "sort_order": 0, "values": [
     {"id": "a1000000-0000-0000-0000-000000000030", "value": "30 ml", "sort_order": 0},
     {"id": "a1000000-0000-0000-0000-000000000050", "value": "50 ml", "sort_order": 1}]}],
  "variants": [
    {"id": "a2000000-0000-0000-0000-000000000030", "sku": "GU-30", "option_value_ids": ["a1000000-0000-0000-0000-000000000030"], "weight_kg": 0.4,
     "is_default": true, "mastershop_product_id": 2001, "mastershop_variant_id": null, "image_id": null, "sort_order": 0,
     "countries": [{"country_code": "CO", "is_active": true, "price": "120000", "compare_at_price": 150000, "cost": 50000, "stock": 7, "low_stock_threshold": 2}]},
    {"id": "a2000000-0000-0000-0000-000000000050", "sku": "GU-50", "option_value_ids": ["a1000000-0000-0000-0000-000000000050"],
     "is_default": false, "mastershop_product_id": 2002, "sort_order": 1,
     "countries": [{"country_code": "CO", "is_active": true, "price": 200000, "stock": 3}]}],
  "images": [{"media_id": "e0000000-0000-0000-0000-0000000018e1", "role": "primary", "sort_order": 0}]
}$j$::jsonb));
insert into pid select 'uno', p.id, pc.published_at from public.products p join public.product_countries pc on pc.product_id = p.id and pc.country_code = 'CO' where p.slug = 'guardar-uno';

select is((select j ->> 'ok' from r where k = 'alta'), 'true', 'alta: ok');
select is((select (j ->> 'product_id')::uuid from r where k = 'alta'), (select id from pid where k = 'uno'), 'alta: devuelve el product_id creado');
select is((select min_price from public.catalog_listing where product_id = (select id from pid where k = 'uno') and country_code = 'CO'), 120000::bigint,
          'alta: catalog_listing refrescado con el precio (string numérico aceptado)');
select ok((select img_primary is not null and is_visible from public.catalog_listing where product_id = (select id from pid where k = 'uno') and country_code = 'CO'),
          'alta: imagen principal y visible en el listado');
select isnt((select pub from pid where k = 'uno'), null, 'alta: published_at se fija al quedar visible');

-- Edición: quita GU-50 y el valor 50 ml, cambia el nombre y el stock; stock_reserved no se toca
update public.variant_countries set stock_reserved = 2 where variant_id = 'a2000000-0000-0000-0000-000000000030' and country_code = 'CO';
insert into r select 'editar', public.admin_guardar_producto(jsonb_build_object(
  'product', jsonb_build_object('id', (select id from pid where k = 'uno'), 'name', 'Guardar Uno Editado', 'slug', 'guardar-uno', 'status', 'active',
                                'brand_id', 'b0000000-0000-0000-0000-0000000018d1'),
  'category_ids', '[]'::jsonb,
  'countries', '[{"country_code": "CO", "is_visible": true, "is_featured": true, "featured_rank": 3, "badges": []}, {"country_code": "EC", "is_visible": false, "is_featured": false, "badges": []}]'::jsonb,
  'options', '[{"id": "a1000000-0000-0000-0000-000000000018", "name": "Tamaño", "sort_order": 0, "values": [{"id": "a1000000-0000-0000-0000-000000000030", "value": "30 ml", "sort_order": 0}]}]'::jsonb,
  'variants', '[{"id": "a2000000-0000-0000-0000-000000000030", "sku": "GU-30", "option_value_ids": ["a1000000-0000-0000-0000-000000000030"], "weight_kg": 0.4, "is_default": true,
                 "mastershop_product_id": 2001, "mastershop_variant_id": null, "image_id": null, "sort_order": 0,
                 "countries": [{"country_code": "CO", "is_active": true, "price": 125000, "compare_at_price": null, "cost": 50000, "stock": 10, "low_stock_threshold": 2}]}]'::jsonb,
  'images', '[]'::jsonb));

select is((select j ->> 'ok' from r where k = 'editar'), 'true', 'edición: ok');
select is((select count(*)::int from public.product_variants where product_id = (select id from pid where k = 'uno')), 1, 'edición: la variante que no viene se borra');
select is((select stock || '/' || stock_reserved from public.variant_countries where variant_id = 'a2000000-0000-0000-0000-000000000030' and country_code = 'CO'), '10/2',
          'edición: stock nuevo y stock_reserved intacto');
select is((select name || '|' || min_price from public.catalog_listing where product_id = (select id from pid where k = 'uno') and country_code = 'CO'), 'Guardar Uno Editado|125000',
          'edición: catalog_listing refrescado');
select is((select published_at from public.product_countries where product_id = (select id from pid where k = 'uno') and country_code = 'CO'), (select pub from pid where k = 'uno'),
          'edición: published_at no cambia si ya estaba publicado');
select is((select string_agg(o.name || ':' || v.value, ',') from public.product_options o join public.product_option_values v on v.option_id = o.id
            where o.product_id = (select id from pid where k = 'uno')), 'Tamaño:30 ml', 'edición: opciones y valores sincronizados');

-- Errores (nada se escribe)
insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, payment_method, status, subtotal, total_customer)
  values ('d0000000-0000-0000-0000-0000000018e1', 'CO', 'COP', 'A', 'B', '+573000000001', 'wompi', 'pendiente_pago', 125000, 125000);
insert into public.order_items (order_id, variant_id, sku, name_snapshot, quantity, unit_price)
  values ('d0000000-0000-0000-0000-0000000018e1', 'a2000000-0000-0000-0000-000000000030', 'GU-30', 'Guardar', 1, 125000);
insert into r select 'pedidos', public.admin_guardar_producto(jsonb_build_object(
  'product', jsonb_build_object('id', (select id from pid where k = 'uno'), 'name', 'No Debe Quedar', 'slug', 'guardar-uno', 'status', 'active'),
  'variants', '[{"id": "a2000000-0000-0000-0000-000000000070", "sku": "GU-70", "is_default": true, "mastershop_product_id": 2003,
                 "countries": [{"country_code": "CO", "is_active": true, "price": 1}]}]'::jsonb));
select is((select j ->> 'motivo' from r where k = 'pedidos'), 'variante_con_pedidos', 'borrar una variante con pedidos: variante_con_pedidos');
select is((select name from public.products where id = (select id from pid where k = 'uno')), 'Guardar Uno Editado', 'con error no se aplica ningún cambio');

insert into r values
  ('sku', public.admin_guardar_producto('{"product": {"name": "Otro", "slug": "guardar-otro", "status": "draft"},
     "variants": [{"sku": "GU-30", "is_default": true, "countries": [{"country_code": "CO", "price": 1}]}]}')),
  ('slug', public.admin_guardar_producto('{"product": {"name": "Otro", "slug": "guardar-uno", "status": "draft"}}')),
  ('defecto', public.admin_guardar_producto('{"product": {"name": "Otro", "slug": "guardar-otro", "status": "draft"},
     "variants": [{"sku": "GO-1", "is_default": true}, {"sku": "GO-2", "is_default": true}]}')),
  ('vinculo', public.admin_guardar_producto('{"product": {"name": "Otro", "slug": "guardar-otro", "status": "active"},
     "countries": [{"country_code": "CO", "is_visible": true}],
     "variants": [{"sku": "GO-1", "is_default": true, "mastershop_product_id": null, "countries": [{"country_code": "CO", "is_active": true, "price": 1000}]}]}')),
  ('borrador', public.admin_guardar_producto('{"product": {"name": "Borrador", "slug": "guardar-borrador", "status": "draft"},
     "countries": [{"country_code": "CO", "is_visible": true}],
     "variants": [{"sku": "GB-1", "is_default": true, "countries": [{"country_code": "CO", "is_active": true, "price": 1000}]}]}')),
  ('decimal', public.admin_guardar_producto('{"product": {"name": "Otro 2", "slug": "guardar-otro-2", "status": "draft"},
     "variants": [{"sku": "GO2-1", "is_default": true, "countries": [{"country_code": "CO", "price": 10.5}]}]}'));
select is((select j ->> 'motivo' from r where k = 'sku'), 'sku_duplicado', 'sku de otro producto: sku_duplicado');
select is((select j ->> 'motivo' from r where k = 'slug'), 'slug_duplicado', 'slug repetido: slug_duplicado');
select is((select j ->> 'motivo' from r where k = 'defecto'), 'sin_variante_por_defecto', 'dos variantes por defecto: sin_variante_por_defecto');
select is((select j ->> 'motivo' || '|' || (j ->> 'detalle') from r where k = 'vinculo'), 'sin_vinculo_mastershop|GO-1', 'activo y visible en CO sin vínculo: sin_vinculo_mastershop');
select is((select j ->> 'ok' from r where k = 'borrador'), 'true', 'en borrador se puede guardar sin vínculo de MasterShop');
select is((select j ->> 'motivo' from r where k = 'decimal'), 'datos_invalidos', 'precio decimal: datos_invalidos');

-- Importación: resuelve por slug, sku y nombres de opción/valor; simular no escribe
create temp table imp (j jsonb) on commit drop;
insert into imp values ($j${"filas": [
  {"product": {"slug": "guardar-uno"},
   "variants": [{"sku": "GU-30", "countries": [{"country_code": "CO", "price": 130000}]}]},
  {"product": {"name": "Import Dos", "slug": "import-dos", "status": "active", "brand_id": "b0000000-0000-0000-0000-0000000018d1"},
   "countries": [{"country_code": "CO", "is_visible": true}],
   "options": [{"name": "Presentación", "values": [{"value": "100 ml"}]}],
   "variants": [{"sku": "IMP-100", "option_values": [{"option": "Presentación", "value": "100 ml"}], "mastershop_product_id": 3001,
                 "countries": [{"country_code": "CO", "is_active": true, "price": 99000, "stock": 4}]}]}
]}$j$);
insert into r select 'simular', public.admin_importar_catalogo((select j from imp) || '{"modo": "simular"}');
select is((select (j ->> 'creados') || '/' || (j ->> 'actualizados') || '/' || jsonb_array_length(j -> 'errores') from r where k = 'simular'), '1/1/0',
          'simular: cuenta creados y actualizados');
select ok(not exists (select 1 from public.products where slug = 'import-dos')
          and (select price from public.variant_countries where variant_id = 'a2000000-0000-0000-0000-000000000030' and country_code = 'CO') = 125000,
          'simular no escribe');

insert into r select 'aplicar', public.admin_importar_catalogo((select j from imp) || '{"modo": "aplicar"}');
select is((select (j ->> 'creados') || '/' || (j ->> 'actualizados') from r where k = 'aplicar'), '1/1', 'aplicar: crea y actualiza');
select is((select cl.min_price || '|' || (select string_agg(v.value, ',') from public.product_option_values v
             join public.product_variants pv on v.id = any(pv.option_value_ids) where pv.sku = 'IMP-100')
             from public.catalog_listing cl where cl.slug = 'import-dos' and cl.country_code = 'CO'), '99000|100 ml',
          'aplicar: refresca catalog_listing y resuelve la opción por nombre');

insert into r select 'repetir', public.admin_importar_catalogo((select j from imp) || '{"modo": "aplicar"}');
insert into r select 'mixto', public.admin_importar_catalogo($j${"modo": "aplicar", "filas": [
  {"product": {"name": "Import Tres", "slug": "import-tres", "status": "draft"}, "variants": [{"sku": "IMP-100", "countries": [{"country_code": "CO", "price": 1}]}]},
  {"product": {"name": "Import Cuatro", "slug": "import-cuatro", "status": "draft"}, "variants": [{"sku": "IMP-400", "countries": [{"country_code": "CO", "price": 1}]}]}
]}$j$::jsonb);
select is((select (j ->> 'sin_cambios') || '/' || (j ->> 'creados') || '/' || (j ->> 'actualizados') from r where k = 'repetir'), '2/0/0', 'reimportar lo mismo: sin_cambios (idempotente)');
select is((select (j -> 'errores' -> 0 ->> 'indice') || '|' || (j -> 'errores' -> 0 ->> 'motivo') || '|' || (j ->> 'creados') from r where k = 'mixto'),
          '0|sku_duplicado|1', 'una fila con error se reporta y no detiene el lote');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin\_%' escape '\' and p.proname in
              ('admin_guardar_producto', 'admin_importar_catalogo', 'admin_sync_producto_interno', 'admin_producto_estado', 'admin_entero', 'admin_textos')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                   or not has_function_privilege('service_role', p.oid, 'execute') or p.prosecdef or not (p.proconfig @> array['search_path=""']))), 0,
          'solo service_role, security invoker y search_path vacío');

select * from finish();
rollback;
