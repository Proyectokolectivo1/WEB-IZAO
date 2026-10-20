-- Pruebas pgtap · Oleada 2: filtro `collection` en catalog_page/catalog_search_page y `stock_bajo` sin umbral.
begin;
set local search_path = public, extensions;
select plan(10);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0'), ('USD', 2, '$', '$ #.##0,00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values
  ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57'), ('EC', 'Ecuador', 'USD', 'es-EC', 'America/Guayaquil', '+593') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO'), ('EC') on conflict do nothing;

insert into public.brands (id, name, slug) values ('b0000000-0000-0000-0000-0000000017d1', 'Marca Col Test', 'marca-col-test');
insert into public.categories (id, name, slug) values ('b0000000-0000-0000-0000-0000000017d4', 'Cat Col', 'cat-col-test');
insert into public.products (id, name, slug, brand_id, status) values
  ('a0000000-0000-0000-0000-0000000017e1', 'Col Uno',  'col-uno',  'b0000000-0000-0000-0000-0000000017d1', 'active'),
  ('a0000000-0000-0000-0000-0000000017e2', 'Col Dos',  'col-dos',  'b0000000-0000-0000-0000-0000000017d1', 'active'),
  ('a0000000-0000-0000-0000-0000000017e3', 'Col Tres', 'col-tres', 'b0000000-0000-0000-0000-0000000017d1', 'active');
insert into public.product_countries (product_id, country_code, is_visible, badges, published_at) values
  ('a0000000-0000-0000-0000-0000000017e1', 'CO', true, '{hot_sale}', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-0000000017e2', 'CO', true, '{}', now() - interval '90 days'),
  ('a0000000-0000-0000-0000-0000000017e3', 'CO', true, '{hot_sale}', now() - interval '200 days');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('f0000000-0000-0000-0000-0000000017e1', 'a0000000-0000-0000-0000-0000000017e1', 'COL-1', true),
  ('f0000000-0000-0000-0000-0000000017e2', 'a0000000-0000-0000-0000-0000000017e2', 'COL-2', true),
  ('f0000000-0000-0000-0000-0000000017e3', 'a0000000-0000-0000-0000-0000000017e3', 'COL-3', true);
insert into public.variant_countries (variant_id, country_code, price, stock, low_stock_threshold) values
  ('f0000000-0000-0000-0000-0000000017e1', 'CO', 100000, 2, null),
  ('f0000000-0000-0000-0000-0000000017e2', 'CO', 200000, 2, 5),
  ('f0000000-0000-0000-0000-0000000017e3', 'CO', 300000, 9, 5);
insert into public.product_categories (product_id, category_id) values ('a0000000-0000-0000-0000-0000000017e2', 'b0000000-0000-0000-0000-0000000017d4');

insert into public.collections (id, country_code, name, slug, type, rule, is_active) values
  ('c0000000-0000-0000-0000-0000000017c1', 'CO', 'Manual', 'col-manual-test', 'manual', null, true),
  ('c0000000-0000-0000-0000-0000000017c2', 'CO', 'Hot', 'col-hot-test', 'rule', '{"badge":"hot_sale"}', true),
  ('c0000000-0000-0000-0000-0000000017c3', 'CO', 'Nuevos', 'col-nuevos-test', 'rule', '{"new_days":30}', true),
  ('c0000000-0000-0000-0000-0000000017c4', 'CO', 'Por categoría', 'col-cat-test', 'rule', '{"category_id":"b0000000-0000-0000-0000-0000000017d4"}', true),
  ('c0000000-0000-0000-0000-0000000017c5', 'CO', 'Inactiva', 'col-inactiva-test', 'manual', null, false),
  ('c0000000-0000-0000-0000-0000000017c6', 'EC', 'Otra', 'col-manual-test', 'manual', null, true);
insert into public.collection_items (collection_id, product_id, sort_order) values
  ('c0000000-0000-0000-0000-0000000017c1', 'a0000000-0000-0000-0000-0000000017e2', 0),
  ('c0000000-0000-0000-0000-0000000017c1', 'a0000000-0000-0000-0000-0000000017e3', 1),
  ('c0000000-0000-0000-0000-0000000017c5', 'a0000000-0000-0000-0000-0000000017e1', 0),
  ('c0000000-0000-0000-0000-0000000017c6', 'a0000000-0000-0000-0000-0000000017e1', 0);

create temp table r (k text primary key, j jsonb) on commit drop;
insert into r values
  ('manual', public.catalog_page('CO', '{"collection":"col-manual-test","with_total":true}', 'price_asc', null, 25)),
  ('hot', public.catalog_page('CO', '{"collection":"col-hot-test","brands":["marca-col-test"]}', 'price_asc', null, 25)),
  ('nuevos', public.catalog_page('CO', '{"collection":"col-nuevos-test","brands":["marca-col-test"]}', 'price_asc', null, 25)),
  ('cat', public.catalog_page('CO', '{"collection":"col-cat-test"}', 'price_asc', null, 25)),
  ('inactiva', public.catalog_page('CO', '{"collection":"col-inactiva-test"}', 'featured', null, 25)),
  ('noexiste', public.catalog_page('CO', '{"collection":"no-existe-col"}', 'featured', null, 25)),
  ('busqueda', public.catalog_search_page('CO', 'col', '{"collection":"col-manual-test"}', 'price_asc', null, 25));

select is((select jsonb_path_query_array(j, '$.items[*].slug') from r where k = 'manual'), '["col-dos","col-tres"]'::jsonb,
          'colección manual: solo sus productos y en el orden pedido');
select is((select (j ->> 'total_estimado')::int from r where k = 'manual'), 2, 'colección manual: total_estimado cuenta solo la colección');
select is((select jsonb_path_query_array(j, '$.items[*].slug') from r where k = 'hot'), '["col-uno","col-tres"]'::jsonb, 'regla badge');
select is((select jsonb_path_query_array(j, '$.items[*].slug') from r where k = 'nuevos'), '["col-uno"]'::jsonb, 'regla new_days');
select is((select jsonb_path_query_array(j, '$.items[*].slug') from r where k = 'cat'), '["col-dos"]'::jsonb, 'regla category_id');
select is((select jsonb_array_length(j -> 'items') from r where k = 'inactiva'), 0, 'colección inactiva: sin resultados');
select is((select jsonb_array_length(j -> 'items') from r where k = 'noexiste'), 0, 'colección inexistente: sin resultados');
select is((select jsonb_path_query_array(j, '$.items[*].slug') from r where k = 'busqueda'), '["col-dos","col-tres"]'::jsonb,
          'la búsqueda también respeta la colección');

select is((public.catalog_product('CO', 'col-uno') -> 'variants' -> 0 ->> 'stock_bajo')::boolean, false,
          'stock_bajo es false (no null) cuando la variante no tiene umbral');
select is((public.catalog_product('CO', 'col-dos') -> 'variants' -> 0 ->> 'stock_bajo')::boolean, true,
          'stock_bajo es true con stock disponible bajo el umbral');

select * from finish();
rollback;
