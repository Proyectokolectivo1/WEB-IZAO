-- Oleada 2 (pedido de izao-tienda): filtro `collection` (slug de la colección del país) en catalog_page y
-- catalog_search_page. Manual: productos de collection_items. Regla: badge, new_days, best_sellers_days
-- (sales_30d > 0) o category_id. Inexistente, inactiva o regla desconocida: sin resultados.
-- Corrección: catalog_product devolvía stock_bajo = null cuando la variante no tiene low_stock_threshold.
-- Las firmas no cambian: los grants de 20261020042322 siguen vigentes.

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
  v_collslug text;
  v_coll record;
  v_coll_ids uuid[];
  v_coll_badge text;
  v_coll_since timestamptz;
  v_coll_sales boolean := false;
  v_coll_cat uuid;
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
  v_collslug := nullif(v_filters ->> 'collection', '');
  if v_collslug is not null then
    select c.id, c.type, c.rule into v_coll
      from public.collections c where c.country_code = p_country and c.slug = v_collslug and c.is_active;
    if not found then
      v_coll_ids := '{}';  -- colección inexistente o inactiva: sin resultados
    elsif v_coll.type = 'manual' then
      v_coll_ids := array(select ci.product_id from public.collection_items ci where ci.collection_id = v_coll.id);
    else
      v_coll_badge := nullif(v_coll.rule ->> 'badge', '');
      if (v_coll.rule ->> 'new_days') ~ '^[0-9]{1,4}$' then
        v_coll_since := now() - make_interval(days => (v_coll.rule ->> 'new_days')::int);
      end if;
      v_coll_sales := v_coll.rule ? 'best_sellers_days';
      if (v_coll.rule ->> 'category_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_coll_cat := (v_coll.rule ->> 'category_id')::uuid;
      end if;
      if v_coll_badge is null and v_coll_since is null and not v_coll_sales and v_coll_cat is null then
        v_coll_ids := '{}';  -- regla desconocida: sin resultados
      end if;
    end if;
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
    || ' and (not $12 or cl.in_stock)'
    || ' and ($17::uuid[] is null or cl.product_id = any($17))'
    || ' and ($18::text is null or cl.badges @> array[$18::text])'
    || ' and ($19::timestamptz is null or cl.published_at >= $19)'
    || ' and (not $20 or cl.sales_30d > 0)'
    || ' and ($21::uuid is null or cl.category_ids @> array[$21::uuid])';
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
          v_cs, v_cv, v_cid, v_limit + 1, v_coll_ids, v_coll_badge, v_coll_since, v_coll_sales, v_coll_cat;

  if jsonb_array_length(v_rows) > v_limit then
    v_last := v_rows -> (v_limit - 1);
    v_next := jsonb_build_object('o', v_sort, 's', (v_last ->> '_s')::int, 'v', v_last ->> '_v', 'id', v_last ->> 'product_id');
  end if;
  select coalesce(jsonb_agg(e - '_s' - '_v' order by n), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_rows) with ordinality t(e, n) where n <= v_limit;

  if coalesce((v_filters ->> 'with_total')::boolean, false) then
    execute 'select count(*) from public.catalog_listing cl' || v_where into v_total
      using p_country, v_tsq, v_qs, v_brands, v_families, v_gender, v_conc, v_cat, v_avail, v_pmin, v_pmax, v_hide,
            v_cs, v_cv, v_cid, v_limit + 1, v_coll_ids, v_coll_badge, v_coll_since, v_coll_sales, v_coll_cat;
  end if;
  if v_cv is null then  -- primera página: rango de precios real del país para la barra de precio
    select min(cl.min_price), max(cl.max_price) into v_pmin_c, v_pmax_c
      from public.catalog_listing cl where cl.country_code = p_country and cl.is_visible;
  end if;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next, 'total_estimado', v_total,
                            'precio_min', v_pmin_c, 'precio_max', v_pmax_c);
end;
$$;

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
               'stock_bajo', coalesce(vc.stock - vc.stock_reserved > 0 and vc.stock - vc.stock_reserved <= vc.low_stock_threshold, false),
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


comment on function public.catalog_page(text, jsonb, text, jsonb, integer) is 'Listado keyset del catálogo: {items, next_cursor, total_estimado, precio_min, precio_max}. Filtros: gender, brands, families, concentration, category, collection, availability, price_min, price_max, with_total. Solo service_role.';
