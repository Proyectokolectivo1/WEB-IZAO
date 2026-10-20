-- Oleada 2 (pedido de izao-admin, T2.6c y T2.7 del panel): guardado atómico del producto e importación de catálogo.
-- Contrato completo en docs/estado/izao-db.md. Todas solo service_role, security invoker, search_path vacío.
--   admin_guardar_producto(p)  -> {ok, product_id, creado} | {ok:false, motivo, detalle}
--   admin_importar_catalogo(p) -> {ok, modo, creados, actualizados, sin_cambios, errores[], cambios[]}
-- Motivos: variante_con_pedidos, sku_duplicado, slug_duplicado, sin_variante_por_defecto, sin_vinculo_mastershop, datos_invalidos.
-- Nunca se toca variant_countries.stock_reserved. Un país de variante que deja de venir se borra, o se desactiva si tiene reservas.

-- Entero en unidad menor desde number o string numérico. null/ausente -> null.
create or replace function public.admin_entero(v jsonb, campo text)
returns bigint
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  elsif jsonb_typeof(v) = 'number' and (v::text)::numeric = trunc((v::text)::numeric) and abs((v::text)::numeric) < 1e18 then
    return (v::text)::numeric::bigint;
  elsif jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*-?[0-9]{1,18}\s*$' then
    return btrim(v #>> '{}')::bigint;
  end if;
  raise exception 'datos_invalidos' using errcode = 'IZ001', detail = campo || ' debe ser un entero en unidad menor';
end;
$$;

-- text[] desde un arreglo jsonb o un texto separado por '|'. null/ausente -> '{}'.
create or replace function public.admin_textos(v jsonb)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case jsonb_typeof(v)
           when 'array' then array(select btrim(e) from jsonb_array_elements_text(v) e where btrim(e) <> '')
           when 'string' then array(select btrim(e) from unnest(string_to_array(v #>> '{}', '|')) e where btrim(e) <> '')
           else '{}'::text[] end;
$$;

-- Estado comparable del producto (sin marcas de tiempo ni stock_reserved) para detectar cambios en la importación.
create or replace function public.admin_producto_estado(p_product_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'product', (select to_jsonb(p) - 'id' - 'created_at' - 'updated_at' from public.products p where p.id = p_product_id),
    'category_ids', (select coalesce(jsonb_agg(pc.category_id order by pc.category_id), '[]'::jsonb)
                       from public.product_categories pc where pc.product_id = p_product_id),
    'countries', (select coalesce(jsonb_agg(to_jsonb(pc) - 'product_id' - 'created_at' - 'updated_at' order by pc.country_code), '[]'::jsonb)
                    from public.product_countries pc where pc.product_id = p_product_id),
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'sort_order', o.sort_order, 'values',
                  (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'value', v.value, 'sort_order', v.sort_order) order by v.id), '[]'::jsonb)
                     from public.product_option_values v where v.option_id = o.id)) order by o.id), '[]'::jsonb)
                  from public.product_options o where o.product_id = p_product_id),
    'variants', (select coalesce(jsonb_agg((to_jsonb(v) - 'product_id' - 'created_at' - 'updated_at') || jsonb_build_object('countries',
                   (select coalesce(jsonb_agg(to_jsonb(vc) - 'variant_id' - 'created_at' - 'updated_at' - 'stock_reserved' order by vc.country_code), '[]'::jsonb)
                      from public.variant_countries vc where vc.variant_id = v.id)) order by v.sku), '[]'::jsonb)
                   from public.product_variants v where v.product_id = p_product_id),
    'images', (select coalesce(jsonb_agg(to_jsonb(pi) - 'product_id' - 'created_at' - 'updated_at' order by pi.media_id), '[]'::jsonb)
                 from public.product_images pi where pi.product_id = p_product_id));
$$;

-- Escritura del producto completo en una subtransacción. p_completo = true (panel): lo que no viene se borra.
-- p_completo = false (importación): solo agrega o actualiza lo que viene. No refresca catalog_listing: lo hace quien llama.
create or replace function public.admin_sync_producto_interno(p jsonb, p_completo boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_prod jsonb := coalesce(p -> 'product', '{}'::jsonb);
  v_pid uuid;
  v_creado boolean := false;
  v_opts jsonb;
  v_vals jsonb;
  v_vars jsonb;
  v_o jsonb;
  v_val jsonb;
  v_v jsonb;
  v_vc jsonb;
  v_oid uuid;
  v_vid uuid;
  v_ovs uuid[];
  v_ccs text[];
  v_n int;
  v_def int;
  v_tot int;
  v_txt text;
  v_msg text;
  v_det text;
  v_con text;
begin
  begin
    if jsonb_typeof(v_prod) <> 'object' then
      raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'falta product';
    end if;
    v_pid := nullif(v_prod ->> 'id', '')::uuid;

    -- Producto
    if v_pid is null or not exists (select 1 from public.products x where x.id = v_pid) then
      if coalesce(btrim(v_prod ->> 'name'), '') = '' or coalesce(btrim(v_prod ->> 'slug'), '') = '' then
        raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'name y slug son obligatorios';
      end if;
      if exists (select 1 from public.products x where x.slug = v_prod ->> 'slug') then
        raise exception 'slug_duplicado' using errcode = 'IZ001', detail = v_prod ->> 'slug';
      end if;
      if v_prod ? 'attributes' and jsonb_typeof(v_prod -> 'attributes') <> 'object' then
        raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'attributes debe ser un objeto';
      end if;
      insert into public.products (id, name, slug, short_description, description_html, brand_id, gender_id, family_id, concentration_id,
                                   notes_top, notes_heart, notes_base, occasion, season, longevity, sillage, attributes,
                                   seo_title, seo_description, status)
      values (coalesce(v_pid, gen_random_uuid()), btrim(v_prod ->> 'name'), v_prod ->> 'slug', v_prod ->> 'short_description', v_prod ->> 'description_html',
              nullif(v_prod ->> 'brand_id', '')::uuid, nullif(v_prod ->> 'gender_id', '')::uuid, nullif(v_prod ->> 'family_id', '')::uuid,
              nullif(v_prod ->> 'concentration_id', '')::uuid,
              public.admin_textos(v_prod -> 'notes_top'), public.admin_textos(v_prod -> 'notes_heart'), public.admin_textos(v_prod -> 'notes_base'),
              public.admin_textos(v_prod -> 'occasion'), public.admin_textos(v_prod -> 'season'),
              nullif(v_prod ->> 'longevity', ''), nullif(v_prod ->> 'sillage', ''), coalesce(v_prod -> 'attributes', '{}'::jsonb),
              v_prod ->> 'seo_title', v_prod ->> 'seo_description', coalesce(nullif(v_prod ->> 'status', ''), 'draft'))
      returning id into v_pid;
      v_creado := true;
    else
      if v_prod ? 'slug' and exists (select 1 from public.products x where x.slug = v_prod ->> 'slug' and x.id <> v_pid) then
        raise exception 'slug_duplicado' using errcode = 'IZ001', detail = v_prod ->> 'slug';
      end if;
      if v_prod ? 'attributes' and jsonb_typeof(v_prod -> 'attributes') <> 'object' then
        raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'attributes debe ser un objeto';
      end if;
      update public.products pr set
        name = case when v_prod ? 'name' then btrim(v_prod ->> 'name') else pr.name end,
        slug = case when v_prod ? 'slug' then v_prod ->> 'slug' else pr.slug end,
        short_description = case when v_prod ? 'short_description' then v_prod ->> 'short_description' else pr.short_description end,
        description_html = case when v_prod ? 'description_html' then v_prod ->> 'description_html' else pr.description_html end,
        brand_id = case when v_prod ? 'brand_id' then nullif(v_prod ->> 'brand_id', '')::uuid else pr.brand_id end,
        gender_id = case when v_prod ? 'gender_id' then nullif(v_prod ->> 'gender_id', '')::uuid else pr.gender_id end,
        family_id = case when v_prod ? 'family_id' then nullif(v_prod ->> 'family_id', '')::uuid else pr.family_id end,
        concentration_id = case when v_prod ? 'concentration_id' then nullif(v_prod ->> 'concentration_id', '')::uuid else pr.concentration_id end,
        notes_top = case when v_prod ? 'notes_top' then public.admin_textos(v_prod -> 'notes_top') else pr.notes_top end,
        notes_heart = case when v_prod ? 'notes_heart' then public.admin_textos(v_prod -> 'notes_heart') else pr.notes_heart end,
        notes_base = case when v_prod ? 'notes_base' then public.admin_textos(v_prod -> 'notes_base') else pr.notes_base end,
        occasion = case when v_prod ? 'occasion' then public.admin_textos(v_prod -> 'occasion') else pr.occasion end,
        season = case when v_prod ? 'season' then public.admin_textos(v_prod -> 'season') else pr.season end,
        longevity = case when v_prod ? 'longevity' then nullif(v_prod ->> 'longevity', '') else pr.longevity end,
        sillage = case when v_prod ? 'sillage' then nullif(v_prod ->> 'sillage', '') else pr.sillage end,
        attributes = case when v_prod ? 'attributes' then v_prod -> 'attributes' else pr.attributes end,
        seo_title = case when v_prod ? 'seo_title' then v_prod ->> 'seo_title' else pr.seo_title end,
        seo_description = case when v_prod ? 'seo_description' then v_prod ->> 'seo_description' else pr.seo_description end,
        status = case when v_prod ? 'status' then coalesce(nullif(v_prod ->> 'status', ''), 'draft') else pr.status end
      where pr.id = v_pid;
    end if;

    -- Categorías (si vienen, reemplazan)
    if p ? 'category_ids' then
      delete from public.product_categories pc
       where pc.product_id = v_pid
         and pc.category_id <> all(array(select e::uuid from jsonb_array_elements_text(p -> 'category_ids') e));
      insert into public.product_categories (product_id, category_id)
      select v_pid, e::uuid from jsonb_array_elements_text(p -> 'category_ids') e
      on conflict do nothing;
    end if;

    -- Países del producto. published_at se fija la primera vez que queda visible.
    if p ? 'countries' then
      for v_vc in select x from jsonb_array_elements(p -> 'countries') x loop
        insert into public.product_countries as pc (product_id, country_code, is_visible, is_featured, featured_rank, badges, published_at)
        values (v_pid, upper(v_vc ->> 'country_code'), coalesce((v_vc ->> 'is_visible')::boolean, false),
                coalesce((v_vc ->> 'is_featured')::boolean, false), nullif(v_vc ->> 'featured_rank', '')::int,
                public.admin_textos(v_vc -> 'badges'),
                case when coalesce((v_vc ->> 'is_visible')::boolean, false) then now() end)
        on conflict (product_id, country_code) do update set
          is_visible = case when v_vc ? 'is_visible' then excluded.is_visible else pc.is_visible end,
          is_featured = case when v_vc ? 'is_featured' then excluded.is_featured else pc.is_featured end,
          featured_rank = case when v_vc ? 'featured_rank' then excluded.featured_rank else pc.featured_rank end,
          badges = case when v_vc ? 'badges' then excluded.badges else pc.badges end,
          published_at = coalesce(pc.published_at,
                                  case when (case when v_vc ? 'is_visible' then excluded.is_visible else pc.is_visible end) then now() end);
      end loop;
      if p_completo then
        delete from public.product_countries pc
         where pc.product_id = v_pid
           and pc.country_code <> all(array(select upper(x ->> 'country_code') from jsonb_array_elements(p -> 'countries') x));
      end if;
    end if;

    -- Opciones y valores: id del payload, o el existente por nombre, o uno nuevo
    if p ? 'options' then
      select coalesce(jsonb_agg(o || jsonb_build_object('id', coalesce(nullif(o ->> 'id', ''),
               (select po.id::text from public.product_options po where po.product_id = v_pid and po.name = o ->> 'name'),
               gen_random_uuid()::text)) order by n), '[]'::jsonb)
        into v_opts from jsonb_array_elements(p -> 'options') with ordinality t(o, n);
      if p_completo then
        delete from public.product_options po
         where po.product_id = v_pid and po.id <> all(array(select (o ->> 'id')::uuid from jsonb_array_elements(v_opts) o));
      end if;
      for v_o in select o from jsonb_array_elements(v_opts) o loop
        v_oid := (v_o ->> 'id')::uuid;
        insert into public.product_options as po (id, product_id, name, sort_order)
        values (v_oid, v_pid, btrim(v_o ->> 'name'), coalesce(nullif(v_o ->> 'sort_order', '')::int, 0))
        on conflict (id) do update set
          name = excluded.name,
          sort_order = case when v_o ? 'sort_order' then excluded.sort_order else po.sort_order end
        where po.product_id = excluded.product_id;
        get diagnostics v_n = row_count;
        if v_n = 0 then
          raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'la opción pertenece a otro producto';
        end if;
        if v_o ? 'values' then
          select coalesce(jsonb_agg(x || jsonb_build_object('id', coalesce(nullif(x ->> 'id', ''),
                   (select ov.id::text from public.product_option_values ov where ov.option_id = v_oid and ov.value = x ->> 'value'),
                   gen_random_uuid()::text)) order by n), '[]'::jsonb)
            into v_vals from jsonb_array_elements(v_o -> 'values') with ordinality t(x, n);
          if p_completo then
            delete from public.product_option_values ov
             where ov.option_id = v_oid and ov.id <> all(array(select (x ->> 'id')::uuid from jsonb_array_elements(v_vals) x));
          end if;
          for v_val in select x from jsonb_array_elements(v_vals) x loop
            insert into public.product_option_values as ov (id, option_id, value, sort_order)
            values ((v_val ->> 'id')::uuid, v_oid, btrim(v_val ->> 'value'), coalesce(nullif(v_val ->> 'sort_order', '')::int, 0))
            on conflict (id) do update set
              value = excluded.value,
              sort_order = case when v_val ? 'sort_order' then excluded.sort_order else ov.sort_order end
            where ov.option_id = excluded.option_id;
            get diagnostics v_n = row_count;
            if v_n = 0 then
              raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'el valor pertenece a otra opción';
            end if;
          end loop;
        end if;
      end loop;
    end if;

    -- Variantes: id del payload, o la existente del producto por sku, o una nueva
    if p ? 'variants' then
      select coalesce(jsonb_agg(x || jsonb_build_object('id', coalesce(nullif(x ->> 'id', ''),
               (select pv.id::text from public.product_variants pv where pv.product_id = v_pid and pv.sku = x ->> 'sku'),
               gen_random_uuid()::text)) order by n), '[]'::jsonb)
        into v_vars from jsonb_array_elements(p -> 'variants') with ordinality t(x, n);

      select string_agg(s, ', ' order by s) into v_txt from (
        select x ->> 'sku' as s from jsonb_array_elements(v_vars) x group by x ->> 'sku' having count(*) > 1
        union
        select x ->> 'sku' from jsonb_array_elements(v_vars) x
         where exists (select 1 from public.product_variants pv where pv.sku = x ->> 'sku' and pv.product_id <> v_pid)) d;
      if v_txt is not null then
        raise exception 'sku_duplicado' using errcode = 'IZ001', detail = v_txt;
      end if;
      if exists (select 1 from jsonb_array_elements(v_vars) x where coalesce(btrim(x ->> 'sku'), '') = '') then
        raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'variante sin sku';
      end if;

      select count(*) filter (where coalesce((x ->> 'is_default')::boolean, false)), count(*) into v_def, v_tot
        from jsonb_array_elements(v_vars) x;
      if (p_completo and v_tot > 0 and v_def <> 1) or v_def > 1 then
        raise exception 'sin_variante_por_defecto' using errcode = 'IZ001', detail = 'debe haber exactamente una variante por defecto';
      end if;

      if p_completo then
        select string_agg(pv.sku, ', ' order by pv.sku) into v_txt
          from public.product_variants pv
         where pv.product_id = v_pid
           and pv.id <> all(array(select (x ->> 'id')::uuid from jsonb_array_elements(v_vars) x))
           and exists (select 1 from public.order_items oi where oi.variant_id = pv.id);
        if v_txt is not null then
          raise exception 'variante_con_pedidos' using errcode = 'IZ001', detail = v_txt;
        end if;
        delete from public.product_variants pv
         where pv.product_id = v_pid and pv.id <> all(array(select (x ->> 'id')::uuid from jsonb_array_elements(v_vars) x));
      end if;
      if v_def > 0 then
        update public.product_variants pv set is_default = false where pv.product_id = v_pid and pv.is_default;
      end if;

      for v_v in select x from jsonb_array_elements(v_vars) x loop
        v_vid := (v_v ->> 'id')::uuid;
        v_ovs := null;
        if v_v ? 'option_value_ids' then
          v_ovs := array(select e::uuid from jsonb_array_elements_text(v_v -> 'option_value_ids') e);
        elsif v_v ? 'option_values' then
          v_ovs := array(select (select ov.id from public.product_option_values ov
                                   join public.product_options o on o.id = ov.option_id
                                  where o.product_id = v_pid and o.name = e ->> 'option' and ov.value = e ->> 'value')
                           from jsonb_array_elements(v_v -> 'option_values') e);
          if array_position(v_ovs, null) is not null then
            raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'opción o valor inexistente en ' || (v_v ->> 'sku');
          end if;
        end if;
        insert into public.product_variants as pv (id, product_id, sku, option_value_ids, weight_kg, is_default,
                                                   mastershop_product_id, mastershop_variant_id, image_id, sort_order)
        values (v_vid, v_pid, btrim(v_v ->> 'sku'), coalesce(v_ovs, '{}'), coalesce(nullif(v_v ->> 'weight_kg', '')::numeric, 0.5),
                coalesce((v_v ->> 'is_default')::boolean, false),
                public.admin_entero(v_v -> 'mastershop_product_id', 'mastershop_product_id')::int,
                public.admin_entero(v_v -> 'mastershop_variant_id', 'mastershop_variant_id')::int,
                nullif(v_v ->> 'image_id', '')::uuid, coalesce(nullif(v_v ->> 'sort_order', '')::int, 0))
        on conflict (id) do update set
          sku = excluded.sku,
          option_value_ids = case when v_ovs is null then pv.option_value_ids else excluded.option_value_ids end,
          weight_kg = case when v_v ? 'weight_kg' then excluded.weight_kg else pv.weight_kg end,
          is_default = case when v_v ? 'is_default' then excluded.is_default else pv.is_default end,
          mastershop_product_id = case when v_v ? 'mastershop_product_id' then excluded.mastershop_product_id else pv.mastershop_product_id end,
          mastershop_variant_id = case when v_v ? 'mastershop_variant_id' then excluded.mastershop_variant_id else pv.mastershop_variant_id end,
          image_id = case when v_v ? 'image_id' then excluded.image_id else pv.image_id end,
          sort_order = case when v_v ? 'sort_order' then excluded.sort_order else pv.sort_order end
        where pv.product_id = excluded.product_id;
        get diagnostics v_n = row_count;
        if v_n = 0 then
          raise exception 'sku_duplicado' using errcode = 'IZ001', detail = v_v ->> 'sku';
        end if;

        -- Precio, costo y stock por país. stock_reserved nunca se toca.
        if v_v ? 'countries' then
          for v_vc in select x from jsonb_array_elements(v_v -> 'countries') x loop
            insert into public.variant_countries as vc (variant_id, country_code, is_active, price, compare_at_price, cost, stock, low_stock_threshold)
            values (v_vid, upper(v_vc ->> 'country_code'), coalesce((v_vc ->> 'is_active')::boolean, true),
                    public.admin_entero(v_vc -> 'price', 'price'), public.admin_entero(v_vc -> 'compare_at_price', 'compare_at_price'),
                    public.admin_entero(v_vc -> 'cost', 'cost'), coalesce(public.admin_entero(v_vc -> 'stock', 'stock'), 0)::int,
                    public.admin_entero(v_vc -> 'low_stock_threshold', 'low_stock_threshold')::int)
            on conflict (variant_id, country_code) do update set
              is_active = case when v_vc ? 'is_active' then excluded.is_active else vc.is_active end,
              price = case when v_vc ? 'price' then excluded.price else vc.price end,
              compare_at_price = case when v_vc ? 'compare_at_price' then excluded.compare_at_price else vc.compare_at_price end,
              cost = case when v_vc ? 'cost' then excluded.cost else vc.cost end,
              stock = case when v_vc ? 'stock' then excluded.stock else vc.stock end,
              low_stock_threshold = case when v_vc ? 'low_stock_threshold' then excluded.low_stock_threshold else vc.low_stock_threshold end;
          end loop;
          if p_completo then
            v_ccs := array(select upper(x ->> 'country_code') from jsonb_array_elements(v_v -> 'countries') x);
            update public.variant_countries vc set is_active = false
             where vc.variant_id = v_vid and vc.country_code <> all(v_ccs) and vc.stock_reserved > 0 and vc.is_active;
            delete from public.variant_countries vc
             where vc.variant_id = v_vid and vc.country_code <> all(v_ccs) and vc.stock_reserved = 0;
          end if;
        end if;
      end loop;
    end if;

    -- Imágenes (si vienen, reemplazan)
    if p ? 'images' then
      delete from public.product_images pi where pi.product_id = v_pid;
      insert into public.product_images (product_id, media_id, sort_order, role)
      select v_pid, (x ->> 'media_id')::uuid, coalesce(nullif(x ->> 'sort_order', '')::int, (n - 1)::int), coalesce(nullif(x ->> 'role', ''), 'gallery')
        from jsonb_array_elements(p -> 'images') with ordinality t(x, n);
    end if;

    -- Validaciones sobre el estado final
    select count(*) filter (where pv.is_default), count(*) into v_def, v_tot from public.product_variants pv where pv.product_id = v_pid;
    if v_tot > 0 and v_def = 0 then
      if p_completo then
        raise exception 'sin_variante_por_defecto' using errcode = 'IZ001', detail = 'debe haber exactamente una variante por defecto';
      end if;
      update public.product_variants pv set is_default = true
       where pv.id = (select x.id from public.product_variants x where x.product_id = v_pid order by x.sort_order, x.sku limit 1);
    end if;

    select string_agg(pv.sku, ', ' order by pv.sku) into v_txt
      from public.product_variants pv
     where pv.product_id = v_pid
       and exists (select 1 from unnest(pv.option_value_ids) u(id)
                    where u.id not in (select ov.id from public.product_option_values ov
                                         join public.product_options o on o.id = ov.option_id where o.product_id = v_pid));
    if v_txt is not null then
      raise exception 'datos_invalidos' using errcode = 'IZ001', detail = 'option_value_ids sin opción del producto en ' || v_txt;
    end if;

    -- Colombia despacha con MasterShop: un producto activo y visible en CO necesita el vínculo en cada variante activa (§14.3)
    select string_agg(pv.sku, ', ' order by pv.sku) into v_txt
      from public.product_variants pv
      join public.variant_countries vc on vc.variant_id = pv.id and vc.country_code = 'CO' and vc.is_active
     where pv.product_id = v_pid and pv.mastershop_product_id is null
       and exists (select 1 from public.products pr
                     join public.product_countries pc on pc.product_id = pr.id and pc.country_code = 'CO' and pc.is_visible
                    where pr.id = v_pid and pr.status = 'active');
    if v_txt is not null then
      raise exception 'sin_vinculo_mastershop' using errcode = 'IZ001', detail = v_txt;
    end if;

  exception
    when sqlstate 'IZ001' then
      get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
      return jsonb_build_object('ok', false, 'motivo', v_msg, 'detalle', nullif(v_det, ''));
    when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      return jsonb_build_object('ok', false,
        'motivo', case v_con when 'products_slug_key' then 'slug_duplicado'
                             when 'product_variants_sku_key' then 'sku_duplicado'
                             when 'product_variants_one_default_idx' then 'sin_variante_por_defecto'
                             else 'datos_invalidos' end,
        'detalle', v_con);
    when foreign_key_violation then
      get stacked diagnostics v_con = constraint_name;
      return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'referencia inexistente: ' || v_con);
    when integrity_constraint_violation or data_exception then
      get stacked diagnostics v_con = constraint_name, v_msg = message_text;
      return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', left(coalesce(nullif(v_con, ''), v_msg), 160));
  end;
  return jsonb_build_object('ok', true, 'product_id', v_pid, 'creado', v_creado);
end;
$$;

-- Guardado del panel: sincronización completa en una transacción y un solo refresco de catalog_listing.
create or replace function public.admin_guardar_producto(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('izao.skip_catalog_refresh', true), '');
  v_r jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'payload vacío');
  end if;
  -- Los triggers refrescarían una vez por fila: se pausan y se refresca una sola vez al final (mismo resultado).
  perform set_config('izao.skip_catalog_refresh', 'on', true);
  v_r := public.admin_sync_producto_interno(p, true);
  perform set_config('izao.skip_catalog_refresh', v_prev, true);
  if (v_r ->> 'ok')::boolean then
    perform public.refresh_catalog_listing((v_r ->> 'product_id')::uuid);
  end if;
  return v_r;
end;
$$;

-- Importación: un producto por fila, atómico por fila; 'simular' ejecuta lo mismo y lo deshace.
create or replace function public.admin_importar_catalogo(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_modo text := p ->> 'modo';
  v_prev text := coalesce(current_setting('izao.skip_catalog_refresh', true), '');
  v_f jsonb;
  v_i int;
  v_pid uuid;
  v_r jsonb;
  v_antes jsonb;
  v_despues jsonb;
  v_campos jsonb;
  v_slug text;
  v_skus text[];
  v_slugs text[] := '{}';
  v_todos_skus text[] := '{}';
  v_rep text;
  v_ids uuid[] := '{}';
  v_creados int := 0;
  v_actualizados int := 0;
  v_sin_cambios int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_cambios jsonb := '[]'::jsonb;
begin
  if v_modo is null or v_modo not in ('simular', 'aplicar') then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'modo debe ser simular o aplicar');
  end if;
  if jsonb_typeof(p -> 'filas') <> 'array' or jsonb_array_length(p -> 'filas') > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'filas debe ser un arreglo de hasta 1000 productos');
  end if;

  perform set_config('izao.skip_catalog_refresh', 'on', true);
  for v_f, v_i in select x, (n - 1)::int from jsonb_array_elements(p -> 'filas') with ordinality t(x, n) loop
    v_r := null;
    v_campos := '[]'::jsonb;
    v_antes := null;
    v_slug := v_f -> 'product' ->> 'slug';
    v_skus := array(select x ->> 'sku' from jsonb_array_elements(case when jsonb_typeof(v_f -> 'variants') = 'array' then v_f -> 'variants' else '[]'::jsonb end) x);

    -- Repetidos dentro del mismo archivo
    if v_slug = any(v_slugs) then
      v_r := jsonb_build_object('ok', false, 'motivo', 'slug_duplicado', 'detalle', v_slug || ' repetido en el archivo');
    else
      select string_agg(s, ', ') into v_rep from unnest(v_skus) s where s = any(v_todos_skus);
      if v_rep is not null then
        v_r := jsonb_build_object('ok', false, 'motivo', 'sku_duplicado', 'detalle', v_rep || ' repetido en el archivo');
      end if;
    end if;

    if v_r is null then
      v_slugs := v_slugs || v_slug;
      v_todos_skus := v_todos_skus || v_skus;
      v_pid := null;
      begin
        v_pid := nullif(v_f -> 'product' ->> 'id', '')::uuid;
      exception when others then
        v_r := jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'product.id');
      end;
      if v_r is null then
        if v_pid is null and v_slug is not null then
          select x.id into v_pid from public.products x where x.slug = v_slug;
          if v_pid is not null then
            v_f := jsonb_set(v_f, '{product,id}', to_jsonb(v_pid));
          end if;
        end if;
        if v_pid is not null then
          v_antes := public.admin_producto_estado(v_pid);
        end if;
        begin
          v_r := public.admin_sync_producto_interno(v_f, false);
          if (v_r ->> 'ok')::boolean then
            v_despues := public.admin_producto_estado((v_r ->> 'product_id')::uuid);
            if (v_r ->> 'creado')::boolean or v_antes is null then
              select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_campos
                from jsonb_object_keys(v_f) k where k <> 'product';
              v_campos := '["product"]'::jsonb || v_campos;
            else
              select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_campos from (
                select 'product.' || a.key as k from jsonb_each(v_despues -> 'product') a
                 where a.value is distinct from (v_antes -> 'product' -> a.key)
                union all
                select a.key from jsonb_each(v_despues) a where a.key <> 'product' and a.value is distinct from (v_antes -> a.key)) d;
            end if;
          end if;
          if v_modo = 'simular' then
            raise exception 'simulacion' using errcode = 'IZ002';
          end if;
        exception when sqlstate 'IZ002' then
          null;  -- se deshace la fila; v_r y v_campos conservan el resultado
        end;
      end if;
    end if;

    if not (v_r ->> 'ok')::boolean then
      v_errores := v_errores || jsonb_build_object('indice', v_i, 'motivo', v_r ->> 'motivo', 'detalle', v_r ->> 'detalle',
        'sku', case when v_r ->> 'motivo' in ('sku_duplicado', 'variante_con_pedidos', 'sin_vinculo_mastershop')
                    then split_part(split_part(v_r ->> 'detalle', ', ', 1), ' ', 1) end);
    elsif (v_r ->> 'creado')::boolean then
      v_creados := v_creados + 1;
      v_cambios := v_cambios || jsonb_build_object('indice', v_i, 'tipo', 'crear', 'campos', v_campos);
      v_ids := v_ids || (v_r ->> 'product_id')::uuid;
    elsif jsonb_array_length(v_campos) = 0 then
      v_sin_cambios := v_sin_cambios + 1;
    else
      v_actualizados := v_actualizados + 1;
      v_cambios := v_cambios || jsonb_build_object('indice', v_i, 'tipo', 'actualizar', 'campos', v_campos);
      v_ids := v_ids || (v_r ->> 'product_id')::uuid;
    end if;
  end loop;
  perform set_config('izao.skip_catalog_refresh', v_prev, true);

  if v_modo = 'aplicar' and cardinality(v_ids) > 0 then
    perform public.refresh_catalog_listing_many(v_ids);
  end if;
  return jsonb_build_object('ok', true, 'modo', v_modo, 'creados', v_creados, 'actualizados', v_actualizados,
                            'sin_cambios', v_sin_cambios, 'errores', v_errores, 'cambios', v_cambios);
end;
$$;

comment on function public.admin_guardar_producto(jsonb) is 'Panel: guarda el producto completo (sincronización total) en una transacción. {ok, product_id, creado} o {ok:false, motivo, detalle}. Solo service_role.';
comment on function public.admin_importar_catalogo(jsonb) is 'Panel: importa productos (modo simular|aplicar), atómico por fila, sin borrar lo que no viene. Solo service_role.';
comment on function public.admin_sync_producto_interno(jsonb, boolean) is 'Interna de admin_guardar_producto y admin_importar_catalogo. No refresca catalog_listing.';

revoke execute on function
  public.admin_entero(jsonb, text), public.admin_textos(jsonb), public.admin_producto_estado(uuid),
  public.admin_sync_producto_interno(jsonb, boolean), public.admin_guardar_producto(jsonb), public.admin_importar_catalogo(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.admin_entero(jsonb, text), public.admin_textos(jsonb), public.admin_producto_estado(uuid),
  public.admin_sync_producto_interno(jsonb, boolean), public.admin_guardar_producto(jsonb), public.admin_importar_catalogo(jsonb)
  to service_role;
