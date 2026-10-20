-- T2.7 · Consultas del catálogo para la tienda y el panel (§6.4, §7.1–7.3, §7.6). Aditiva y reversible (drop function / drop index).
--
-- catalog_page(p_country, p_filters, p_sort, p_cursor, p_limit)   listado con paginación KEYSET (nunca OFFSET)
-- catalog_search_page(p_country, p_q, p_filters, p_sort, p_cursor, p_limit)   resultados de búsqueda, mismo cursor
-- catalog_suggest(p_country, p_q, p_limit)   sugerencias en vivo: productos, marcas y familias
-- catalog_product(p_country, p_slug)   ficha completa (null si no existe o no es visible en el país)
-- catalog_related(p_country, p_product_id, p_limit)   misma familia y género, en stock
--
-- Todas devuelven jsonb. Los montos son enteros en unidad menor (JSON number). security invoker, search_path vacío,
-- EXECUTE solo service_role. Nunca devuelven costos, stock reservado ni IDs de MasterShop.
--
-- Filtros (p_filters, todos opcionales): gender (slug), brands (slugs), families (slugs), concentration (slug),
--   category (slug; incluye la categoría padre), availability ('in_stock'), price_min / price_max (unidad menor, sobre
--   min_price), with_total (true: calcula total_estimado). country_settings.hide_out_of_stock oculta los agotados.
-- Órdenes: featured (defecto), sales, newest, price_asc, price_desc, discount; relevance solo en la búsqueda.
--   Salvo featured (cuyo sort_featured ya pone los agotados al final), todos ordenan primero por in_stock.
-- Cursor: {"o": orden, "s": in_stock 0/1, "v": valor del orden como texto, "id": product_id}; es opaco para el cliente.

-- Índices por orden: (país, in_stock desc, clave, product_id) sobre las filas visibles. Sustituyen a los de la fase 0,
-- que no incluían in_stock y por eso no servían para el keyset con agotados al final.
drop index public.catalog_listing_price_idx;
drop index public.catalog_listing_published_idx;
drop index public.catalog_listing_sales_idx;
create index catalog_listing_sales_idx on public.catalog_listing (country_code, in_stock desc, sales_30d desc, product_id) where is_visible;
create index catalog_listing_newest_idx on public.catalog_listing
  (country_code, in_stock desc, (coalesce(published_at, 'epoch'::timestamptz)) desc, product_id) where is_visible;
create index catalog_listing_price_asc_idx on public.catalog_listing (country_code, in_stock desc, min_price, product_id) where is_visible;
create index catalog_listing_price_desc_idx on public.catalog_listing (country_code, in_stock desc, min_price desc, product_id) where is_visible;
create index catalog_listing_discount_idx on public.catalog_listing (country_code, in_stock desc, discount_pct desc, product_id) where is_visible;

-- Piezas comunes ---------------------------------------------------------------------------------------------------
create or replace function public.media_json(m public.media)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('media_id', m.id, 'base_path', m.base_path, 'variants', m.variants,
                            'lqip', m.lqip, 'alt', m.alt, 'width', m.width, 'height', m.height);
$$;

create or replace function public.catalog_item_json(cl public.catalog_listing)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'product_id', cl.product_id, 'slug', cl.slug, 'name', cl.name,
    'brand_name', cl.brand_name, 'brand_slug', cl.brand_slug,
    'gender_slug', cl.gender_slug, 'family_slug', cl.family_slug, 'concentration_slug', cl.concentration_slug,
    'min_price', cl.min_price, 'max_price', cl.max_price, 'compare_at_price', cl.compare_at_price,
    'discount_pct', cl.discount_pct, 'in_stock', cl.in_stock, 'variant_count', cl.variant_count,
    'img_primary', cl.img_primary, 'img_hover', cl.img_hover,
    'badges', coalesce(to_jsonb(cl.badges), '[]'::jsonb),
    'rating_avg', cl.rating_avg, 'rating_count', cl.rating_count, 'published_at', cl.published_at);
$$;

-- Consulta común del listado y de la búsqueda (interna) -------------------------------------------------------------
create or replace function public.catalog_query_interno(
  p_country text, p_q text, p_filters jsonb, p_sort text, p_cursor jsonb, p_limit integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_sort text;
  v_val text;
  v_dir text;
  v_cast text;
  v_lead boolean := true;
  v_qs text;
  v_tsq tsquery;
  v_words text[];
  v_brands text[];
  v_families text[];
  v_gender text;
  v_conc text;
  v_cat uuid;
  v_catslug text;
  v_avail boolean;
  v_pmin bigint;
  v_pmax bigint;
  v_hide boolean;
  v_cs int;
  v_cv text;
  v_cid uuid;
  v_keyset text := '';
  v_where text;
  v_order text;
  v_sql text;
  v_rows jsonb;
  v_items jsonb;
  v_last jsonb;
  v_next jsonb;
  v_total bigint;
  v_pmin_c bigint;
  v_pmax_c bigint;
begin
  v_sort := coalesce(p_sort, case when p_q is null then 'featured' else 'relevance' end);
  case v_sort
    when 'featured'   then v_val := 'sort_featured';  v_dir := 'desc'; v_cast := 'bigint'; v_lead := false;
    when 'sales'      then v_val := 'sales_30d';      v_dir := 'desc'; v_cast := 'int';
    when 'newest'     then v_val := 'coalesce(published_at, ''epoch''::timestamptz)'; v_dir := 'desc'; v_cast := 'timestamptz';
    when 'price_asc'  then v_val := 'min_price';      v_dir := 'asc';  v_cast := 'bigint';
    when 'price_desc' then v_val := 'min_price';      v_dir := 'desc'; v_cast := 'bigint';
    when 'discount'   then v_val := 'discount_pct';   v_dir := 'desc'; v_cast := 'smallint';
    when 'relevance'  then
      if p_q is null then
        raise exception 'orden_invalido' using errcode = '22023', detail = 'relevance solo aplica a la búsqueda';
      end if;
      v_val := 'round(1000 * greatest(ts_rank(search_tsv, $2), extensions.similarity(name_unaccent, $3)))::int';
      v_dir := 'desc'; v_cast := 'int';
    else
      raise exception 'orden_invalido' using errcode = '22023', detail = v_sort;
  end case;

  -- Búsqueda: texto sin tildes ni símbolos, con prefijo en la última palabra
  if p_q is not null then
    v_words := array(select w from unnest(regexp_split_to_array(
                 regexp_replace(lower(public.f_unaccent(btrim(p_q))), '[^a-z0-9 ]', ' ', 'g'), '\s+')) w where w <> '');
    if coalesce(array_length(v_words, 1), 0) = 0 then
      return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null, 'total_estimado', null, 'precio_min', null, 'precio_max', null);
    end if;
    v_qs := array_to_string(v_words, ' ');
    v_tsq := to_tsquery('spanish', array_to_string(array(select w || ':*' from unnest(v_words) w), ' & '));
  end if;

  -- Filtros
  v_brands := nullif(case jsonb_typeof(v_filters -> 'brands')
                       when 'array' then array(select jsonb_array_elements_text(v_filters -> 'brands'))
                       when 'string' then array[v_filters ->> 'brands'] end, '{}'::text[]);
  v_families := nullif(case jsonb_typeof(v_filters -> 'families')
                         when 'array' then array(select jsonb_array_elements_text(v_filters -> 'families'))
                         when 'string' then array[v_filters ->> 'families'] end, '{}'::text[]);
  v_gender := nullif(v_filters ->> 'gender', '');
  v_conc := nullif(v_filters ->> 'concentration', '');
  v_catslug := nullif(v_filters ->> 'category', '');
  if v_catslug is not null then
    select c.id into v_cat from public.categories c where c.slug = v_catslug;
    v_cat := coalesce(v_cat, '00000000-0000-0000-0000-000000000000'::uuid);  -- categoría inexistente: sin resultados
  end if;
  v_avail := coalesce(v_filters ->> 'availability', '') = 'in_stock';
  v_pmin := (v_filters ->> 'price_min')::bigint;
  v_pmax := (v_filters ->> 'price_max')::bigint;
  select coalesce(cs.hide_out_of_stock, false) into v_hide from public.country_settings cs where cs.country_code = p_country;
  v_hide := coalesce(v_hide, false);

  -- Cursor
  if p_cursor is not null and jsonb_typeof(p_cursor) = 'object' then
    begin
      v_cs := (p_cursor ->> 's')::int;
      v_cv := p_cursor ->> 'v';
      v_cid := (p_cursor ->> 'id')::uuid;
    exception when others then
      raise exception 'cursor_invalido' using errcode = '22023';
    end;
    if v_cv is null or v_cid is null or coalesce(p_cursor ->> 'o', v_sort) <> v_sort then
      raise exception 'cursor_invalido' using errcode = '22023';
    end if;
    if v_lead then
      v_keyset := format(' and ((in_stock::int < $13) or (in_stock::int = $13 and ((%1$s %2$s $14::%3$s) or (%1$s = $14::%3$s and product_id > $15))))',
                         v_val, case v_dir when 'desc' then '<' else '>' end, v_cast);
    else
      v_keyset := format(' and ((%1$s %2$s $14::%3$s) or (%1$s = $14::%3$s and product_id > $15))',
                         v_val, case v_dir when 'desc' then '<' else '>' end, v_cast);
    end if;
  end if;

  v_where := ' where cl.country_code = $1 and cl.is_visible'
    || ' and ($2 is null or cl.search_tsv @@ $2 or cl.name_unaccent operator(extensions.%) $3)'
    || ' and ($4::text[] is null or cl.brand_slug = any($4))'
    || ' and ($5::text[] is null or cl.family_slug = any($5))'
    || ' and ($6::text is null or cl.gender_slug = $6)'
    || ' and ($7::text is null or cl.concentration_slug = $7)'
    || ' and ($8::uuid is null or cl.category_ids @> array[$8])'
    || ' and (not $9 or cl.in_stock)'
    || ' and ($10::bigint is null or cl.min_price >= $10)'
    || ' and ($11::bigint is null or cl.min_price <= $11)'
    || ' and (not $12 or cl.in_stock)';
  v_order := ' order by ' || case when v_lead then 'cl.in_stock desc, ' else '' end || v_val || ' ' || v_dir || ', cl.product_id asc';
  -- Las expresiones del orden usan columnas sin alias: se resuelven contra catalog_listing cl
  v_sql := 'select coalesce(jsonb_agg(q.item order by q.ord), ''[]''::jsonb) from ('
    || 'select public.catalog_item_json(cl) || jsonb_build_object(''_s'', cl.in_stock::int, ''_v'', (' || v_val || ')::text) as item,'
    || ' row_number() over (' || trim(v_order) || ') as ord'
    || ' from public.catalog_listing cl' || v_where
    || v_keyset
    || v_order || ' limit $16) q';

  execute v_sql into v_rows
    using p_country, v_tsq, v_qs, v_brands, v_families, v_gender, v_conc, v_cat, v_avail, v_pmin, v_pmax, v_hide,
          v_cs, v_cv, v_cid, v_limit + 1;

  if jsonb_array_length(v_rows) > v_limit then
    v_last := v_rows -> (v_limit - 1);
    v_next := jsonb_build_object('o', v_sort, 's', (v_last ->> '_s')::int, 'v', v_last ->> '_v', 'id', v_last ->> 'product_id');
  end if;
  select coalesce(jsonb_agg(e - '_s' - '_v' order by n), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_rows) with ordinality t(e, n) where n <= v_limit;

  if coalesce((v_filters ->> 'with_total')::boolean, false) then
    execute 'select count(*) from public.catalog_listing cl' || v_where into v_total
      using p_country, v_tsq, v_qs, v_brands, v_families, v_gender, v_conc, v_cat, v_avail, v_pmin, v_pmax, v_hide,
            v_cs, v_cv, v_cid, v_limit + 1;
  end if;
  if v_cv is null then  -- primera página: rango de precios real del país para la barra de precio
    select min(cl.min_price), max(cl.max_price) into v_pmin_c, v_pmax_c
      from public.catalog_listing cl where cl.country_code = p_country and cl.is_visible;
  end if;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next, 'total_estimado', v_total,
                            'precio_min', v_pmin_c, 'precio_max', v_pmax_c);
end;
$$;

create or replace function public.catalog_page(
  p_country text, p_filters jsonb default '{}'::jsonb, p_sort text default 'featured',
  p_cursor jsonb default null, p_limit integer default 25)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.catalog_query_interno(p_country, null, p_filters, coalesce(p_sort, 'featured'), p_cursor, p_limit);
$$;

create or replace function public.catalog_search_page(
  p_country text, p_q text, p_filters jsonb default '{}'::jsonb, p_sort text default 'relevance',
  p_cursor jsonb default null, p_limit integer default 25)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.catalog_query_interno(p_country, coalesce(p_q, ''), p_filters, coalesce(p_sort, 'relevance'), p_cursor, p_limit);
$$;

-- Sugerencias en vivo -----------------------------------------------------------------------------------------------
create or replace function public.catalog_suggest(p_country text, p_q text, p_limit integer default 6)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_words text[];
  v_qs text;
  v_tsq tsquery;
  v_prod jsonb;
  v_brands jsonb;
  v_fams jsonb;
begin
  v_words := array(select w from unnest(regexp_split_to_array(
               regexp_replace(lower(public.f_unaccent(btrim(coalesce(p_q, '')))), '[^a-z0-9 ]', ' ', 'g'), '\s+')) w where w <> '');
  if coalesce(array_length(v_words, 1), 0) = 0 or length(array_to_string(v_words, ' ')) < 2 then
    return jsonb_build_object('productos', '[]'::jsonb, 'marcas', '[]'::jsonb, 'familias', '[]'::jsonb);
  end if;
  v_qs := array_to_string(v_words, ' ');
  v_tsq := to_tsquery('spanish', array_to_string(array(select w || ':*' from unnest(v_words) w), ' & '));

  select coalesce(jsonb_agg(q.item order by q.ord), '[]'::jsonb) into v_prod from (
    select jsonb_build_object('product_id', cl.product_id, 'slug', cl.slug, 'name', cl.name, 'brand_name', cl.brand_name,
             'min_price', cl.min_price, 'in_stock', cl.in_stock, 'img_primary', cl.img_primary) as item,
           row_number() over (order by cl.in_stock desc,
             (greatest(ts_rank(cl.search_tsv, v_tsq), extensions.similarity(cl.name_unaccent, v_qs))
               + case when cl.name_unaccent like v_qs || '%' then 1 else 0 end) desc, cl.name, cl.product_id) as ord
      from public.catalog_listing cl
     where cl.country_code = p_country and cl.is_visible
       and (cl.search_tsv @@ v_tsq or cl.name_unaccent operator(extensions.%) v_qs
            or cl.name_unaccent like v_qs || '%' or cl.name_unaccent like '% ' || v_qs || '%')
     order by cl.in_stock desc,
              (greatest(ts_rank(cl.search_tsv, v_tsq), extensions.similarity(cl.name_unaccent, v_qs))
                + case when cl.name_unaccent like v_qs || '%' then 1 else 0 end) desc, cl.name, cl.product_id
     limit v_limit) q;

  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name) order by x.ord), '[]'::jsonb) into v_brands from (
    select b.slug, b.name, row_number() over (order by extensions.similarity(lower(public.f_unaccent(b.name)), v_qs) desc, b.name) as ord
      from public.brands b
     where exists (select 1 from public.catalog_listing cl where cl.brand_slug = b.slug and cl.country_code = p_country and cl.is_visible)
       and (lower(public.f_unaccent(b.name)) like v_qs || '%' or lower(public.f_unaccent(b.name)) like '% ' || v_qs || '%'
            or extensions.similarity(lower(public.f_unaccent(b.name)), v_qs) > 0.3)
     order by extensions.similarity(lower(public.f_unaccent(b.name)), v_qs) desc, b.name
     limit v_limit) x;

  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name) order by x.ord), '[]'::jsonb) into v_fams from (
    select f.slug, f.name, row_number() over (order by extensions.similarity(lower(public.f_unaccent(f.name)), v_qs) desc, f.name) as ord
      from public.olfactory_families f
     where exists (select 1 from public.catalog_listing cl where cl.family_slug = f.slug and cl.country_code = p_country and cl.is_visible)
       and (lower(public.f_unaccent(f.name)) like v_qs || '%' or lower(public.f_unaccent(f.name)) like '% ' || v_qs || '%'
            or extensions.similarity(lower(public.f_unaccent(f.name)), v_qs) > 0.3)
     order by extensions.similarity(lower(public.f_unaccent(f.name)), v_qs) desc, f.name
     limit v_limit) x;

  return jsonb_build_object('productos', v_prod, 'marcas', v_brands, 'familias', v_fams);
end;
$$;

-- Ficha completa ----------------------------------------------------------------------------------------------------
create or replace function public.catalog_product(p_country text, p_slug text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cl public.catalog_listing;
  pr record;
  v_base jsonb;
begin
  select * into cl from public.catalog_listing c where c.country_code = p_country and c.slug = p_slug and c.is_visible;
  if not found then
    return null;
  end if;
  select p.short_description, p.description_html, p.notes_top, p.notes_heart, p.notes_base, p.occasion, p.season,
         p.longevity, p.sillage, p.attributes, p.seo_title, p.seo_description,
         g.name as gender_name, f.name as family_name, c.name as concentration_name
    into pr
    from public.products p
    left join public.genders g on g.id = p.gender_id
    left join public.olfactory_families f on f.id = p.family_id
    left join public.concentrations c on c.id = p.concentration_id
   where p.id = cl.product_id;

  v_base := public.catalog_item_json(cl) || jsonb_build_object(
    'short_description', pr.short_description, 'description_html', pr.description_html,
    'gender_name', pr.gender_name, 'family_name', pr.family_name, 'concentration_name', pr.concentration_name,
    'notes_top', coalesce(to_jsonb(pr.notes_top), '[]'::jsonb), 'notes_heart', coalesce(to_jsonb(pr.notes_heart), '[]'::jsonb),
    'notes_base', coalesce(to_jsonb(pr.notes_base), '[]'::jsonb),
    'occasion', coalesce(to_jsonb(pr.occasion), '[]'::jsonb), 'season', coalesce(to_jsonb(pr.season), '[]'::jsonb),
    'longevity', pr.longevity, 'sillage', pr.sillage, 'attributes', coalesce(pr.attributes, '{}'::jsonb),
    'seo_title', pr.seo_title, 'seo_description', pr.seo_description);

  return v_base || jsonb_build_object(
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id, 'sku', v.sku, 'is_default', v.is_default, 'option_value_ids', coalesce(to_jsonb(v.option_value_ids), '[]'::jsonb),
               'price', vc.price,
               'compare_at_price', case when vc.compare_at_price > vc.price then vc.compare_at_price end,
               'stock_disponible', greatest(vc.stock - vc.stock_reserved, 0),
               'in_stock', vc.stock - vc.stock_reserved > 0,
               'stock_bajo', vc.stock - vc.stock_reserved > 0 and vc.stock - vc.stock_reserved <= vc.low_stock_threshold,
               'image', case when m.id is not null then public.media_json(m) end)
             order by v.is_default desc, v.sort_order, v.sku), '[]'::jsonb)
        from public.product_variants v
        join public.variant_countries vc on vc.variant_id = v.id and vc.country_code = p_country and vc.is_active
        left join public.media m on m.id = v.image_id
       where v.product_id = cl.product_id),
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'values', (
               select coalesce(jsonb_agg(jsonb_build_object('id', ov.id, 'value', ov.value) order by ov.sort_order, ov.value), '[]'::jsonb)
                 from public.product_option_values ov where ov.option_id = o.id)) order by o.sort_order, o.name), '[]'::jsonb)
        from public.product_options o where o.product_id = cl.product_id),
    'images', (
      select coalesce(jsonb_agg(jsonb_build_object('role', pi.role, 'sort_order', pi.sort_order, 'media', public.media_json(m))
               order by (pi.role = 'primary') desc, (pi.role = 'hover') desc, pi.sort_order, pi.created_at), '[]'::jsonb)
        from public.product_images pi join public.media m on m.id = pi.media_id where pi.product_id = cl.product_id),
    'reviews', jsonb_build_object(
      'avg', cl.rating_avg, 'count', cl.rating_count,
      'distribution', (
        select jsonb_object_agg(s.n::text, coalesce(d.qty, 0))
          from generate_series(1, 5) s(n)
          left join (select r.rating, count(*)::int as qty from public.reviews r
                      where r.product_id = cl.product_id and r.country_code = p_country and r.status = 'approved'
                      group by r.rating) d on d.rating = s.n),
      'latest', (
        select coalesce(jsonb_agg(jsonb_build_object('author_name', x.author_name, 'city', x.city, 'rating', x.rating, 'body', x.body,
                 'is_verified_purchase', x.is_verified_purchase, 'created_at', x.created_at) order by x.created_at desc, x.id), '[]'::jsonb)
          from (select r.* from public.reviews r
                 where r.product_id = cl.product_id and r.country_code = p_country and r.status = 'approved'
                 order by r.created_at desc, r.id limit 10) x)));
end;
$$;

-- También te puede gustar -------------------------------------------------------------------------------------------
create or replace function public.catalog_related(p_country text, p_product_id uuid, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(x.product_id order by x.sort_featured desc, x.product_id) into v_ids from (
    select r.product_id, r.sort_featured
      from public.catalog_listing s
      join public.catalog_listing r on r.country_code = s.country_code and r.family_slug = s.family_slug and r.gender_slug = s.gender_slug
     where s.product_id = p_product_id and s.country_code = p_country
       and r.is_visible and r.in_stock and r.product_id <> s.product_id
     order by r.sort_featured desc, r.product_id
     limit least(greatest(coalesce(p_limit, 8), 1), 24)) x;
  return (select coalesce(jsonb_agg(public.catalog_item_json(c) order by c.sort_featured desc, c.product_id), '[]'::jsonb)
            from public.catalog_listing c where c.country_code = p_country and c.product_id = any(coalesce(v_ids, '{}')));
end;
$$;

comment on function public.catalog_page(text, jsonb, text, jsonb, integer) is 'Listado keyset del catálogo: {items, next_cursor, total_estimado, precio_min, precio_max}. Solo service_role.';
comment on function public.catalog_search_page(text, text, jsonb, text, jsonb, integer) is 'Búsqueda con el mismo cursor y forma que catalog_page. Solo service_role.';
comment on function public.catalog_suggest(text, text, integer) is 'Sugerencias {productos, marcas, familias} tolerantes a tildes y errores. Solo service_role.';
comment on function public.catalog_product(text, text) is 'Ficha completa del producto en el país, o null. Solo service_role.';
comment on function public.catalog_related(text, uuid, integer) is 'Productos de la misma familia y género, visibles y en stock. Solo service_role.';

revoke execute on function
  public.media_json(public.media), public.catalog_item_json(public.catalog_listing),
  public.catalog_query_interno(text, text, jsonb, text, jsonb, integer),
  public.catalog_page(text, jsonb, text, jsonb, integer),
  public.catalog_search_page(text, text, jsonb, text, jsonb, integer),
  public.catalog_suggest(text, text, integer), public.catalog_product(text, text), public.catalog_related(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.media_json(public.media), public.catalog_item_json(public.catalog_listing),
  public.catalog_query_interno(text, text, jsonb, text, jsonb, integer),
  public.catalog_page(text, jsonb, text, jsonb, integer),
  public.catalog_search_page(text, text, jsonb, text, jsonb, integer),
  public.catalog_suggest(text, text, integer), public.catalog_product(text, text), public.catalog_related(text, uuid, integer)
  to service_role;
