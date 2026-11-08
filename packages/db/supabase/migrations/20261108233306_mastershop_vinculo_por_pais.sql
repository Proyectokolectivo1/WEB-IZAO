-- D-052: vínculo con MasterShop POR PAÍS. Cada país usa su propia cuenta de MasterShop y los ids de producto/variante
-- de la cuenta de EC son distintos a los de CO. Aditiva: no borra ni renombra nada.
--
-- Contrato nuevo
--   variant_countries.mastershop_product_id int null, variant_countries.mastershop_variant_id int null
--     = vínculo de la variante EN ESE PAÍS. Fuente de verdad para checkout (snapshot en order_items), panel y worker.
--     Relleno inicial: CO copia product_variants.mastershop_*; EC queda en null hasta vincular.
--   product_variants.mastershop_product_id / mastershop_variant_id = DEPRECADAS: espejo de la fila CO mientras los
--     lectores se adaptan (triggers en ambos sentidos, solo CO). Una migración futura las retirará.
--   admin_guardar_producto / admin_importar_catalogo:
--     - variants[].countries[] acepta mastershop_product_id y mastershop_variant_id (solo se tocan si la clave viene).
--     - variants[].mastershop_* (nivel variante) sigue aceptándose = vínculo de CO (llega a CO por el espejo); si vienen
--       ambos, gana el de countries[] (se escribe después).
--     - sin_vinculo_mastershop aplica a todo país con country_settings.carrier_provider = 'mastershop' (antes solo CO):
--       producto active + visible en el país + variante activa en el país sin variant_countries.mastershop_product_id.
--       Respuesta {ok:false, motivo:'sin_vinculo_mastershop', detalle:'SKU1, SKU2', paises:['CO','EC']} (paises es nuevo;
--       detalle conserva el formato). En la importación cada error con ese motivo trae también paises.
--
-- Reversión sin pérdida de datos (los valores de CO siguen en product_variants por el espejo):
--   drop trigger mastershop_vinculo_co on public.product_variants;
--   drop trigger mastershop_vinculo_co_completar on public.variant_countries;
--   drop trigger mastershop_vinculo_co_a_variante on public.variant_countries;
--   drop function public.mastershop_vinculo_co_desde_variante(), public.mastershop_vinculo_co_completar(),
--                 public.mastershop_vinculo_variante_desde_co();
--   volver a crear admin_sync_producto_interno y admin_importar_catalogo desde 20261020044538;
--   (opcional, solo si no hay vínculos de EC que conservar) alter table public.variant_countries
--     drop column mastershop_product_id, drop column mastershop_variant_id;

alter table public.variant_countries
  add column if not exists mastershop_product_id integer,
  add column if not exists mastershop_variant_id integer;

comment on column public.variant_countries.mastershop_product_id is
  'Id de producto en la cuenta de MasterShop DE ESTE PAÍS (D-052). Obligatorio para publicar si country_settings.carrier_provider = mastershop.';
comment on column public.variant_countries.mastershop_variant_id is
  'Id de variante en la cuenta de MasterShop de este país (null si el producto no tiene variantes en MasterShop).';
comment on column public.product_variants.mastershop_product_id is
  'DEPRECADA (D-052): espejo de variant_countries CO. Leer variant_countries.mastershop_product_id del país.';
comment on column public.product_variants.mastershop_variant_id is
  'DEPRECADA (D-052): espejo de variant_countries CO. Leer variant_countries.mastershop_variant_id del país.';

-- Relleno: solo CO. Los ids no afectan catalog_listing: se pausa el refresco.
select set_config('izao.skip_catalog_refresh', 'on', true);
update public.variant_countries vc
   set mastershop_product_id = pv.mastershop_product_id,
       mastershop_variant_id = pv.mastershop_variant_id
  from public.product_variants pv
 where pv.id = vc.variant_id
   and vc.country_code = 'CO'
   and (pv.mastershop_product_id is not null or pv.mastershop_variant_id is not null)
   and (vc.mastershop_product_id, vc.mastershop_variant_id) is distinct from (pv.mastershop_product_id, pv.mastershop_variant_id);
select set_config('izao.skip_catalog_refresh', '', true);

-- Espejo temporal CO <-> product_variants. Termina solo: cada lado actualiza únicamente si el valor difiere.
create or replace function public.mastershop_vinculo_co_desde_variante()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.variant_countries vc
     set mastershop_product_id = new.mastershop_product_id,
         mastershop_variant_id = new.mastershop_variant_id
   where vc.variant_id = new.id
     and vc.country_code = 'CO'
     and (vc.mastershop_product_id, vc.mastershop_variant_id) is distinct from (new.mastershop_product_id, new.mastershop_variant_id);
  return null;
end;
$$;

-- Fila CO nueva sin vínculo: hereda el de product_variants (el editor actual aún lo manda a nivel de variante).
create or replace function public.mastershop_vinculo_co_completar()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.mastershop_product_id is null and new.mastershop_variant_id is null then
    new.mastershop_product_id := (select pv.mastershop_product_id from public.product_variants pv where pv.id = new.variant_id);
    new.mastershop_variant_id := (select pv.mastershop_variant_id from public.product_variants pv where pv.id = new.variant_id);
  end if;
  return new;
end;
$$;

create or replace function public.mastershop_vinculo_variante_desde_co()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.product_variants pv
     set mastershop_product_id = new.mastershop_product_id,
         mastershop_variant_id = new.mastershop_variant_id
   where pv.id = new.variant_id
     and (pv.mastershop_product_id, pv.mastershop_variant_id) is distinct from (new.mastershop_product_id, new.mastershop_variant_id);
  return null;
end;
$$;

drop trigger if exists mastershop_vinculo_co on public.product_variants;
create trigger mastershop_vinculo_co
  after update of mastershop_product_id, mastershop_variant_id on public.product_variants
  for each row
  when ((old.mastershop_product_id, old.mastershop_variant_id) is distinct from (new.mastershop_product_id, new.mastershop_variant_id))
  execute function public.mastershop_vinculo_co_desde_variante();

drop trigger if exists mastershop_vinculo_co_completar on public.variant_countries;
create trigger mastershop_vinculo_co_completar
  before insert on public.variant_countries
  for each row
  when (new.country_code = 'CO')
  execute function public.mastershop_vinculo_co_completar();

drop trigger if exists mastershop_vinculo_co_a_variante on public.variant_countries;
create trigger mastershop_vinculo_co_a_variante
  after insert or update of mastershop_product_id, mastershop_variant_id on public.variant_countries
  for each row
  when (new.country_code = 'CO')
  execute function public.mastershop_vinculo_variante_desde_co();

revoke execute on function public.mastershop_vinculo_co_desde_variante(), public.mastershop_vinculo_co_completar(),
  public.mastershop_vinculo_variante_desde_co() from public, anon, authenticated;

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
  v_hint text;
  v_paises text;
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
            insert into public.variant_countries as vc (variant_id, country_code, is_active, price, compare_at_price, cost, stock, low_stock_threshold,
                                                        mastershop_product_id, mastershop_variant_id)
            values (v_vid, upper(v_vc ->> 'country_code'), coalesce((v_vc ->> 'is_active')::boolean, true),
                    public.admin_entero(v_vc -> 'price', 'price'), public.admin_entero(v_vc -> 'compare_at_price', 'compare_at_price'),
                    public.admin_entero(v_vc -> 'cost', 'cost'), coalesce(public.admin_entero(v_vc -> 'stock', 'stock'), 0)::int,
                    public.admin_entero(v_vc -> 'low_stock_threshold', 'low_stock_threshold')::int,
                    public.admin_entero(v_vc -> 'mastershop_product_id', 'mastershop_product_id')::int,
                    public.admin_entero(v_vc -> 'mastershop_variant_id', 'mastershop_variant_id')::int)
            on conflict (variant_id, country_code) do update set
              -- Del payload y no de excluded: el trigger de CO completa excluded con el espejo y un null explícito se perdería.
              mastershop_product_id = case when v_vc ? 'mastershop_product_id'
                                           then public.admin_entero(v_vc -> 'mastershop_product_id', 'mastershop_product_id')::int
                                           else vc.mastershop_product_id end,
              mastershop_variant_id = case when v_vc ? 'mastershop_variant_id'
                                           then public.admin_entero(v_vc -> 'mastershop_variant_id', 'mastershop_variant_id')::int
                                           else vc.mastershop_variant_id end,
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

    -- Todo país que despacha con MasterShop (country_settings.carrier_provider = 'mastershop'): un producto activo y
    -- visible allí necesita el vínculo DE ESE PAÍS (variant_countries.mastershop_product_id) en cada variante activa (§14.3, D-052).
    select string_agg(distinct pv.sku, ', ' order by pv.sku), string_agg(distinct vc.country_code, ',' order by vc.country_code)
      into v_txt, v_paises
      from public.product_variants pv
      join public.variant_countries vc on vc.variant_id = pv.id and vc.is_active and vc.mastershop_product_id is null
      join public.country_settings cs on cs.country_code = vc.country_code and cs.carrier_provider = 'mastershop'
      join public.product_countries pc on pc.product_id = pv.product_id and pc.country_code = vc.country_code and pc.is_visible
      join public.products pr on pr.id = pv.product_id and pr.status = 'active'
     where pv.product_id = v_pid;
    if v_txt is not null then
      raise exception 'sin_vinculo_mastershop' using errcode = 'IZ001', detail = v_txt, hint = v_paises;
    end if;

  exception
    when sqlstate 'IZ001' then
      get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail, v_hint = pg_exception_hint;
      return jsonb_build_object('ok', false, 'motivo', v_msg, 'detalle', nullif(v_det, ''))
             || case when v_msg = 'sin_vinculo_mastershop' and coalesce(v_hint, '') <> ''
                     then jsonb_build_object('paises', to_jsonb(string_to_array(v_hint, ','))) else '{}'::jsonb end;
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
                    then split_part(split_part(v_r ->> 'detalle', ', ', 1), ' ', 1) end)
        || case when v_r ? 'paises' then jsonb_build_object('paises', v_r -> 'paises') else '{}'::jsonb end;
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

comment on function public.admin_sync_producto_interno(jsonb, boolean) is
  'Interna de admin_guardar_producto y admin_importar_catalogo. No refresca catalog_listing. Vínculo MasterShop por país en variants[].countries[] (D-052).';

revoke execute on function public.admin_sync_producto_interno(jsonb, boolean), public.admin_importar_catalogo(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_sync_producto_interno(jsonb, boolean), public.admin_importar_catalogo(jsonb)
  to service_role;
