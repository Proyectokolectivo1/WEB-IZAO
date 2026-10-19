-- Pruebas pgTAP · catalog_listing (§6.4): refresco, triggers, flag de sesión e idempotencia
-- Ejecutar con pg_prove o dentro de una transacción; todo se revierte al final.
begin;
set local search_path = public, extensions;
select plan(20);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP',0,'$','$ #.##0'), ('USD',2,'$','$ #.##0,00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values
  ('CO','Colombia','COP','es-CO','America/Bogota','+57'), ('EC','Ecuador','USD','es-EC','America/Guayaquil','+593') on conflict do nothing;
insert into public.brands (id, name, slug) values ('b0000000-0000-0000-0000-000000000001', 'Casa Prueba', 'casa-prueba');
insert into public.categories (id, name, slug) values ('e0000000-0000-0000-0000-000000000001', 'Padre', 'padre-test');
insert into public.categories (id, parent_id, name, slug) values ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'Hija', 'hija-test');
insert into public.products (id, name, slug, brand_id, status, notes_top) values
  ('a0000000-0000-0000-0000-000000000001', 'Ámbar Nocturno', 'ambar-nocturno', 'b0000000-0000-0000-0000-000000000001', 'active', '{vainilla}');
insert into public.product_countries (product_id, country_code, is_visible, is_featured, featured_rank, published_at) values
  ('a0000000-0000-0000-0000-000000000001', 'CO', true, true, 1, '2026-10-01');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'T-60', false),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'T-100', true);
insert into public.variant_countries (variant_id, country_code, price, compare_at_price, stock) values
  ('f0000000-0000-0000-0000-000000000001', 'CO', 90000, 120000, 2),
  ('f0000000-0000-0000-0000-000000000002', 'CO', 150000, null, 0);
insert into public.product_categories (product_id, category_id) values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002');

select is((select count(*)::int from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 1, 'una fila por (producto, pais)');
select results_eq($$select min_price, max_price, compare_at_price, discount_pct::int, variant_count, in_stock, is_visible from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'$$,
  $$values (90000::bigint, 150000::bigint, 120000::bigint, 25, 2, true, true)$$, 'precios, descuento, stock y visibilidad calculados');
select ok((select 'e0000000-0000-0000-0000-000000000001'::uuid = any(category_ids) and 'e0000000-0000-0000-0000-000000000002'::uuid = any(category_ids) from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'category_ids incluye la categoria y su padre');
select ok((select search_tsv @@ websearch_to_tsquery('spanish', public.f_unaccent('ámbar casa')) from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'search_tsv encuentra por nombre y marca sin tildes');
select is((select name_unaccent from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'ambar nocturno', 'name_unaccent normalizado');
select ok((select sort_featured >= 100000000000000000 from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'con stock: sort_featured en el bloque superior');

update public.variant_countries set stock = 0 where variant_id = 'f0000000-0000-0000-0000-000000000001';
select ok((select not in_stock and sort_featured < 100000000000000000 from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'agotado: in_stock falso y al final del orden');
update public.variant_countries set stock_reserved = 0, stock = 3 where variant_id = 'f0000000-0000-0000-0000-000000000001';
update public.variant_countries set stock_reserved = 3 where variant_id = 'f0000000-0000-0000-0000-000000000001';
select ok((select not in_stock from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'stock reservado no cuenta como disponible');
update public.variant_countries set stock_reserved = 0 where variant_id = 'f0000000-0000-0000-0000-000000000001';

insert into public.product_countries (product_id, country_code, is_visible) values ('a0000000-0000-0000-0000-000000000001', 'EC', true);
select ok((select not is_visible and variant_count = 0 from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001' and country_code = 'EC'), 'EC sin variantes activas: no visible');
delete from public.product_countries where product_id = 'a0000000-0000-0000-0000-000000000001' and country_code = 'EC';
select is((select count(*)::int from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 1, 'al quitar un pais se borra su fila');

insert into public.reviews (country_code, product_id, author_name, rating, status) values
  ('CO', 'a0000000-0000-0000-0000-000000000001', 'A', 4, 'approved'),
  ('CO', 'a0000000-0000-0000-0000-000000000001', 'B', 5, 'approved'),
  ('CO', 'a0000000-0000-0000-0000-000000000001', 'C', 1, 'pending');
select results_eq($$select rating_avg, rating_count from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'$$, $$values (4.50::numeric(3,2), 2)$$, 'solo resenas aprobadas en el rating');

update public.brands set name = 'Casa Renombrada' where id = 'b0000000-0000-0000-0000-000000000001';
select is((select brand_name from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'Casa Renombrada', 'cambio de marca se propaga');

update public.products set status = 'draft' where id = 'a0000000-0000-0000-0000-000000000001';
select ok((select not is_visible from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 'producto en borrador no visible');
update public.products set status = 'active' where id = 'a0000000-0000-0000-0000-000000000001';

-- Flag de sesión para importaciones masivas
select set_config('izao.skip_catalog_refresh', 'on', true);
update public.variant_countries set price = 80000 where variant_id = 'f0000000-0000-0000-0000-000000000001';
select is((select min_price from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 90000::bigint, 'con izao.skip_catalog_refresh=on no se refresca');
select set_config('izao.skip_catalog_refresh', 'off', true);
select is(public.refresh_catalog_listing_many(array['a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid]), 1, 'refresco por lote deduplica');
select is((select min_price from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 80000::bigint, 'refresco por lote aplica el cambio');

create temp table _snap as select * from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001';
select public.refresh_catalog_listing('a0000000-0000-0000-0000-000000000001');
select public.refresh_catalog_listing('a0000000-0000-0000-0000-000000000001');
select results_eq(
  $$select product_id, country_code, min_price, max_price, discount_pct, in_stock, rating_avg, sort_featured, category_ids, search_tsv::text from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'$$,
  $$select product_id, country_code, min_price, max_price, discount_pct, in_stock, rating_avg, sort_featured, category_ids, search_tsv::text from _snap$$,
  'refresh_catalog_listing es idempotente');
select ok(public.refresh_catalog_listing_all() >= 1, 'refresh_catalog_listing_all recorre los productos');

select throws_ok($$insert into public.categories (parent_id, name, slug) values ('e0000000-0000-0000-0000-000000000002', 'Nieta', 'nieta-test')$$, '23514', null, 'categorias: maximo 2 niveles');

delete from public.products where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.catalog_listing where product_id = 'a0000000-0000-0000-0000-000000000001'), 0, 'al borrar el producto desaparece del listado');

select * from finish();
rollback;
