-- Pruebas pgtap · T2.7: RPC del catálogo (catalog_page, catalog_search_page, catalog_suggest, catalog_product, catalog_related).
begin;
set local search_path = public, extensions;
select plan(23);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0'), ('USD', 2, '$', '$ #.##0,00') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values
  ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57'), ('EC', 'Ecuador', 'USD', 'es-EC', 'America/Guayaquil', '+593') on conflict do nothing;
insert into public.country_settings (country_code) values ('CO'), ('EC') on conflict do nothing;

insert into public.brands (id, name, slug) values ('b0000000-0000-0000-0000-0000000000d1', 'Marca Rpc Test', 'marca-rpc-test');
insert into public.genders (id, name, slug) values ('b0000000-0000-0000-0000-0000000000d2', 'Género Rpc', 'genero-rpc');
insert into public.olfactory_families (id, name, slug) values ('b0000000-0000-0000-0000-0000000000d3', 'Familia Rpc', 'familia-rpc');
insert into public.categories (id, name, slug) values ('b0000000-0000-0000-0000-0000000000d4', 'Padre Rpc', 'padre-rpc');
insert into public.categories (id, parent_id, name, slug) values ('b0000000-0000-0000-0000-0000000000d5', 'b0000000-0000-0000-0000-0000000000d4', 'Hija Rpc', 'hija-rpc');

-- P1..P5 visibles en CO con precios y fechas distintas; P5 agotado (el más barato); P6 oculto en CO y visible en EC; P7 en borrador
insert into public.products (id, name, slug, brand_id, gender_id, family_id, status, short_description) values
  ('a0000000-0000-0000-0000-0000000000e1', 'Ámbar Rpc Uno',    'rpc-uno',    'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'active', 'uno'),
  ('a0000000-0000-0000-0000-0000000000e2', 'Bruma Rpc Dos',    'rpc-dos',    'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'active', 'dos'),
  ('a0000000-0000-0000-0000-0000000000e3', 'Cedro Rpc Tres',   'rpc-tres',   'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'active', 'tres'),
  ('a0000000-0000-0000-0000-0000000000e4', 'Dalia Rpc Cuatro', 'rpc-cuatro', 'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'active', 'cuatro'),
  ('a0000000-0000-0000-0000-0000000000e5', 'Eter Rpc Cinco',   'rpc-cinco',  'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'active', 'cinco'),
  ('a0000000-0000-0000-0000-0000000000e6', 'Fresa Rpc Seis',   'rpc-seis',   'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'active', 'seis'),
  ('a0000000-0000-0000-0000-0000000000e7', 'Gala Rpc Siete',   'rpc-siete',  'b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000d3', 'draft',  'siete');
insert into public.product_countries (product_id, country_code, is_visible, is_featured, featured_rank, published_at) values
  ('a0000000-0000-0000-0000-0000000000e1', 'CO', true, true, 2, '2026-01-01'),
  ('a0000000-0000-0000-0000-0000000000e2', 'CO', true, true, 1, '2026-02-01'),
  ('a0000000-0000-0000-0000-0000000000e3', 'CO', true, false, null, '2026-03-01'),
  ('a0000000-0000-0000-0000-0000000000e4', 'CO', true, false, null, '2026-04-01'),
  ('a0000000-0000-0000-0000-0000000000e5', 'CO', true, true, 3, '2026-05-01'),
  ('a0000000-0000-0000-0000-0000000000e6', 'CO', false, false, null, '2026-06-01'),
  ('a0000000-0000-0000-0000-0000000000e6', 'EC', true, false, null, '2026-06-01'),
  ('a0000000-0000-0000-0000-0000000000e7', 'CO', true, false, null, '2026-07-01');
insert into public.product_variants (id, product_id, sku, is_default) values
  ('f0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'RPC-1', true),
  ('f0000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e2', 'RPC-2', true),
  ('f0000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e3', 'RPC-3', true),
  ('f0000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e4', 'RPC-4', true),
  ('f0000000-0000-0000-0000-0000000000e5', 'a0000000-0000-0000-0000-0000000000e5', 'RPC-5', true),
  ('f0000000-0000-0000-0000-0000000000e6', 'a0000000-0000-0000-0000-0000000000e6', 'RPC-6', true),
  ('f0000000-0000-0000-0000-0000000000e7', 'a0000000-0000-0000-0000-0000000000e7', 'RPC-7', true);
-- precios: P1 300k (tachado 400k), P2 200k, P3 300k (empate con P1), P4 500k, P5 100k agotado, P6 250k, P7 150k
insert into public.variant_countries (variant_id, country_code, is_active, price, compare_at_price, cost, stock) values
  ('f0000000-0000-0000-0000-0000000000e1', 'CO', true, 300000, 400000, 111, 5),
  ('f0000000-0000-0000-0000-0000000000e2', 'CO', true, 200000, null, 111, 5),
  ('f0000000-0000-0000-0000-0000000000e3', 'CO', true, 300000, 330000, 111, 5),
  ('f0000000-0000-0000-0000-0000000000e4', 'CO', true, 500000, null, 111, 5),
  ('f0000000-0000-0000-0000-0000000000e5', 'CO', true, 100000, null, 111, 0),
  ('f0000000-0000-0000-0000-0000000000e6', 'CO', true, 250000, null, 111, 5),
  ('f0000000-0000-0000-0000-0000000000e6', 'EC', true, 2500, null, 111, 5),
  ('f0000000-0000-0000-0000-0000000000e7', 'CO', true, 150000, null, 111, 5);
insert into public.product_categories (product_id, category_id) values ('a0000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000d5');
insert into public.media (id, kind, base_path, variants, lqip, alt) values
  ('e0000000-0000-0000-0000-0000000000e1', 'product', 'product/prueba/rpc-uno', '{"400":"a-400.webp","800":"a-800.webp","1600":"a-1600.webp"}', 'data:image/webp;base64,AAAA', 'uno'),
  ('e0000000-0000-0000-0000-0000000000e2', 'product', 'product/prueba/rpc-uno-b', '{"400":"b-400.webp"}', null, 'uno b');
insert into public.product_images (product_id, media_id, sort_order, role) values
  ('a0000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-0000000000e2', 0, 'gallery'),
  ('a0000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-0000000000e1', 5, 'primary');

-- Recorre todas las páginas con límite 3 y devuelve los product_id en orden
create function pg_temp.recorrer(p_sort text, p_limit int) returns text[] language plpgsql as $$
declare r jsonb; c jsonb := null; ids text[] := '{}'; n int := 0;
begin
  loop
    r := public.catalog_page('CO', '{"brands":["marca-rpc-test"]}'::jsonb, p_sort, c, p_limit);
    ids := ids || array(select i ->> 'product_id' from jsonb_array_elements(r -> 'items') i);
    c := r -> 'next_cursor';
    n := n + 1;
    -- next_cursor llega como null de JSON en la última página (no como NULL de SQL)
    exit when c is null or c = 'null'::jsonb or n > 20;
  end loop;
  return ids;
end $$;

select is(array(select i ->> 'slug' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'featured', null, 100) -> 'items') i),
  array['rpc-dos', 'rpc-uno', 'rpc-cuatro', 'rpc-tres', 'rpc-cinco'],
  'featured: destacados por rank, luego el resto del más nuevo al más viejo, agotado al final; sin oculto ni borrador');
select is(array(select i ->> 'slug' from jsonb_array_elements(public.catalog_page('EC', '{"brands":["marca-rpc-test"]}', 'featured', null, 100) -> 'items') i),
  array['rpc-seis'], 'visibilidad por país: el producto oculto en CO aparece solo en EC');
select is((select count(*)::int from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'featured', null, 100) -> 'items') i
            where i ->> 'slug' = 'rpc-seis'), 0, 'un producto oculto en un país nunca aparece ahí');

select is(pg_temp.recorrer('featured', 2), array(select i ->> 'product_id' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'featured', null, 100) -> 'items') i), 'cursor featured: sin saltos ni repetidos');
select is(pg_temp.recorrer('sales', 2), array(select i ->> 'product_id' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'sales', null, 100) -> 'items') i), 'cursor sales: sin saltos ni repetidos');
select is(pg_temp.recorrer('newest', 2), array(select i ->> 'product_id' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'newest', null, 100) -> 'items') i), 'cursor newest: sin saltos ni repetidos');
select is(pg_temp.recorrer('price_asc', 2), array(select i ->> 'product_id' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'price_asc', null, 100) -> 'items') i), 'cursor price_asc: sin saltos ni repetidos (con empate de precio)');
select is(pg_temp.recorrer('price_desc', 2), array(select i ->> 'product_id' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'price_desc', null, 100) -> 'items') i), 'cursor price_desc: sin saltos ni repetidos');
select is(pg_temp.recorrer('discount', 2), array(select i ->> 'product_id' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'discount', null, 100) -> 'items') i), 'cursor discount: sin saltos ni repetidos');

select is(array(select i ->> 'slug' from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'price_asc', null, 100) -> 'items') i),
  array['rpc-dos', 'rpc-uno', 'rpc-tres', 'rpc-cuatro', 'rpc-cinco'], 'price_asc: el agotado (más barato) va al final y el empate se resuelve por product_id');
select is(public.catalog_page('CO', '{"brands":["marca-rpc-test"],"availability":"in_stock","price_min":250000,"price_max":400000,"category":"padre-rpc"}')
          -> 'items' -> 0 ->> 'slug', 'rpc-uno', 'filtros combinados: marca + disponibilidad + rango de precio + categoría padre');
select is(jsonb_array_length(public.catalog_page('CO', '{"brands":["marca-rpc-test"],"families":["familia-rpc"],"gender":"genero-rpc","price_max":260000,"with_total":true}') -> 'items'), 2, 'familia + género + precio máximo');
select is((public.catalog_page('CO', '{"brands":["marca-rpc-test"],"with_total":true}') ->> 'total_estimado')::int, 5, 'total_estimado cuando se pide');
update public.country_settings set hide_out_of_stock = true where country_code = 'CO';
select is((select count(*)::int from jsonb_array_elements(public.catalog_page('CO', '{"brands":["marca-rpc-test"]}', 'featured', null, 100) -> 'items') i where i ->> 'slug' = 'rpc-cinco'), 0, 'hide_out_of_stock oculta los agotados');
update public.country_settings set hide_out_of_stock = false where country_code = 'CO';
select throws_ok($$select public.catalog_page('CO', '{}', 'featured', '{"o":"featured","s":1,"v":"abc","id":"x"}')$$, '22023', 'cursor_invalido', 'cursor mal formado se rechaza');
select throws_ok($$select public.catalog_page('CO', '{}', 'inventado')$$, '22023', 'orden_invalido', 'orden desconocido se rechaza');

-- Filtrado por la marca de prueba: en una base con catálogo real hay otros "Ámbar"
select is(public.catalog_search_page('CO', 'ambar', '{"brands":["marca-rpc-test"]}') -> 'items' -> 0 ->> 'slug', 'rpc-uno', 'búsqueda tolerante a tildes: "ambar" encuentra "Ámbar"');
select is(public.catalog_search_page('CO', 'ambaar rpc uno', '{}') -> 'items' -> 0 ->> 'slug', 'rpc-uno', 'búsqueda tolerante a errores de tipeo');
select ok((public.catalog_suggest('CO', 'ambar rpc', 5) -> 'productos' -> 0 ->> 'slug') = 'rpc-uno'
          and (public.catalog_suggest('CO', 'ambar rpc', 5) -> 'productos' -> 0 -> 'img_primary') is not null
          and jsonb_array_length(public.catalog_suggest('CO', 'marca rpc', 5) -> 'marcas') = 1
          and jsonb_array_length(public.catalog_suggest('CO', 'familia rp', 5) -> 'familias') = 1, 'sugerencias: producto con miniatura, marca y familia');

select ok(public.catalog_product('CO', 'rpc-seis') is null and public.catalog_product('CO', 'rpc-siete') is null and public.catalog_product('EC', 'rpc-seis') is not null,
  'ficha: null si no es visible en el país');
select ok(public.catalog_product('CO', 'rpc-uno')::text !~ '"cost"|stock_reserved|mastershop' and (public.catalog_product('CO', 'rpc-uno') -> 'images' -> 0 ->> 'role') = 'primary'
          and (public.catalog_product('CO', 'rpc-uno') -> 'variants' -> 0 ->> 'price')::int = 300000, 'ficha: variantes con precio, imágenes con la principal primero y sin costos ni IDs internos');
select is(jsonb_array_length(public.catalog_related('CO', 'a0000000-0000-0000-0000-0000000000e1', 10)), 3, 'relacionados: misma familia y género, en stock, sin el propio ni los agotados ni los ocultos');

select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('catalog_page', 'catalog_search_page', 'catalog_suggest', 'catalog_product', 'catalog_related', 'catalog_query_interno', 'catalog_item_json', 'media_json')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute')
                 or p.prosecdef or not (p.proconfig @> array['search_path=""']))), 0, 'solo service_role, security invoker y search_path vacío');

select * from finish();
rollback;
