-- 0005 · catalog_listing (§6.4): tabla desnormalizada para listados, refresco idempotente y triggers.
-- Una fila por (producto, país) con fila en product_countries.
-- Importaciones masivas: `set local izao.skip_catalog_refresh = 'on'` y al final
-- `select public.refresh_catalog_listing_many(array[...])` o `public.refresh_catalog_listing_all()`.

create table public.catalog_listing (
  product_id uuid not null references public.products (id) on delete cascade,
  country_code text not null references public.countries (code) on delete cascade,
  slug text not null,
  name text not null,
  name_unaccent text not null,
  brand_name text,
  brand_slug text,
  gender_slug text,
  family_slug text,
  concentration_slug text,
  category_ids uuid[] not null default '{}',
  min_price bigint,
  max_price bigint,
  compare_at_price bigint,
  discount_pct smallint not null default 0,
  in_stock boolean not null default false,
  variant_count integer not null default 0,
  img_primary jsonb,
  img_hover jsonb,
  badges text[] not null default '{}',
  rating_avg numeric(3,2),
  rating_count integer not null default 0,
  sales_30d integer not null default 0,
  sort_featured bigint not null default 0,
  published_at timestamptz,
  is_visible boolean not null default false,
  search_tsv tsvector not null default ''::tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, country_code)
);
comment on table public.catalog_listing is
  'Lectura rápida del catálogo (§6.4). Mantenida por refresh_catalog_listing(); no editar a mano.';
comment on column public.catalog_listing.sort_featured is
  'Orden por defecto (desc): con stock primero (×1e17), luego destacados por featured_rank (1 = primero, ×1e10), luego published_at (epoch s).';
comment on column public.catalog_listing.discount_pct is
  'floor((compare_at_price − min_price) × 100 / compare_at_price) de la variante más barata; 0 si no hay tachado.';

-- §6.3
create index catalog_listing_featured_idx on public.catalog_listing (country_code, sort_featured desc, product_id) where is_visible;
create index catalog_listing_price_idx on public.catalog_listing (country_code, min_price, product_id) where is_visible;
create index catalog_listing_published_idx on public.catalog_listing (country_code, published_at desc, product_id) where is_visible;
create index catalog_listing_sales_idx on public.catalog_listing (country_code, sales_30d desc, product_id) where is_visible;
create index catalog_listing_category_ids_idx on public.catalog_listing using gin (category_ids);
create index catalog_listing_search_tsv_idx on public.catalog_listing using gin (search_tsv);
create index catalog_listing_name_trgm_idx on public.catalog_listing using gin (name_unaccent extensions.gin_trgm_ops);
create index catalog_listing_country_code_idx on public.catalog_listing (country_code);

alter table public.catalog_listing enable row level security;
create trigger set_updated_at before update on public.catalog_listing
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Refresco de un producto (idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.refresh_catalog_listing(p_product_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_product_id is null then
    return;
  end if;

  -- Países que ya no aplican (o producto eliminado)
  delete from public.catalog_listing cl
  where cl.product_id = p_product_id
    and not exists (
      select 1 from public.product_countries pc
      where pc.product_id = cl.product_id and pc.country_code = cl.country_code);

  insert into public.catalog_listing as cl (
    product_id, country_code, slug, name, name_unaccent, brand_name, brand_slug, gender_slug,
    family_slug, concentration_slug, category_ids, min_price, max_price, compare_at_price,
    discount_pct, in_stock, variant_count, img_primary, img_hover, badges, rating_avg,
    rating_count, sales_30d, sort_featured, published_at, is_visible, search_tsv)
  select
    p.id,
    pc.country_code,
    p.slug,
    p.name,
    lower(public.f_unaccent(p.name)),
    b.name,
    b.slug,
    g.slug,
    f.slug,
    c.slug,
    coalesce(cats.ids, '{}'),
    vs.min_price,
    vs.max_price,
    case when cheap.compare_at_price > vs.min_price then cheap.compare_at_price end,
    case when cheap.compare_at_price > vs.min_price and cheap.compare_at_price > 0
      then ((cheap.compare_at_price - vs.min_price) * 100 / cheap.compare_at_price)::smallint
      else 0 end,
    coalesce(vs.in_stock, false),
    coalesce(vs.variant_count, 0),
    img1.data,
    img2.data,
    pc.badges,
    rv.rating_avg,
    coalesce(rv.rating_count, 0),
    coalesce(sl.qty, 0),
    (case when coalesce(vs.in_stock, false) then 1 else 0 end)::bigint * 100000000000000000
      + (case when pc.is_featured
           then 1000000 - least(coalesce(pc.featured_rank, 999999), 999999)
           else 0 end)::bigint * 10000000000
      + least(greatest(coalesce(extract(epoch from pc.published_at)::bigint, 0), 0), 9999999999),
    pc.published_at,
    (p.status = 'active' and pc.is_visible and coalesce(vs.variant_count, 0) > 0),
    setweight(to_tsvector('spanish', public.f_unaccent(coalesce(p.name, ''))), 'A')
      || setweight(to_tsvector('spanish', public.f_unaccent(coalesce(b.name, ''))), 'B')
      || setweight(to_tsvector('spanish', public.f_unaccent(concat_ws(' ', f.name, c.name, g.name))), 'C')
      || setweight(to_tsvector('spanish', public.f_unaccent(concat_ws(' ',
           array_to_string(p.notes_top, ' '), array_to_string(p.notes_heart, ' '),
           array_to_string(p.notes_base, ' ')))), 'D')
  from public.products p
  join public.product_countries pc on pc.product_id = p.id
  left join public.brands b on b.id = p.brand_id
  left join public.genders g on g.id = p.gender_id
  left join public.olfactory_families f on f.id = p.family_id
  left join public.concentrations c on c.id = p.concentration_id
  left join lateral (
    select min(vc.price) as min_price,
           max(vc.price) as max_price,
           count(*)::integer as variant_count,
           bool_or(vc.stock - vc.stock_reserved > 0) as in_stock
    from public.product_variants v
    join public.variant_countries vc on vc.variant_id = v.id
    where v.product_id = p.id and vc.country_code = pc.country_code and vc.is_active
  ) vs on true
  left join lateral (
    select vc.compare_at_price
    from public.product_variants v
    join public.variant_countries vc on vc.variant_id = v.id
    where v.product_id = p.id and vc.country_code = pc.country_code and vc.is_active
    order by vc.price asc, v.is_default desc, v.sort_order asc, v.sku asc
    limit 1
  ) cheap on true
  left join lateral (
    select array_agg(distinct x.id order by x.id) as ids
    from (
      select pcat.category_id as id
      from public.product_categories pcat
      where pcat.product_id = p.id
      union
      select cat.parent_id
      from public.product_categories pcat
      join public.categories cat on cat.id = pcat.category_id
      where pcat.product_id = p.id and cat.parent_id is not null
    ) x
  ) cats on true
  left join lateral (
    select m.id as media_id,
           jsonb_build_object('media_id', m.id, 'base_path', m.base_path, 'variants', m.variants,
             'lqip', m.lqip, 'alt', m.alt, 'width', m.width, 'height', m.height) as data
    from public.product_images pi
    join public.media m on m.id = pi.media_id
    where pi.product_id = p.id
    order by (pi.role = 'primary') desc, pi.sort_order asc, pi.created_at asc
    limit 1
  ) img1 on true
  left join lateral (
    select jsonb_build_object('media_id', m.id, 'base_path', m.base_path, 'variants', m.variants,
             'lqip', m.lqip, 'alt', m.alt, 'width', m.width, 'height', m.height) as data
    from public.product_images pi
    join public.media m on m.id = pi.media_id
    where pi.product_id = p.id and pi.media_id is distinct from img1.media_id
    order by (pi.role = 'hover') desc, pi.sort_order asc, pi.created_at asc
    limit 1
  ) img2 on true
  left join lateral (
    select round(avg(r.rating), 2)::numeric(3,2) as rating_avg, count(*)::integer as rating_count
    from public.reviews r
    where r.product_id = p.id and r.country_code = pc.country_code and r.status = 'approved'
  ) rv on true
  left join lateral (
    select sum(oi.quantity)::integer as qty
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = p.id
      and o.country_code = pc.country_code
      and o.paid_at >= now() - interval '30 days'
      and o.status in ('pagado','abono_pagado','error_transportadora','enviado_transportadora',
                       'en_preparacion','en_transito','entregado','reclamacion')
  ) sl on true
  where p.id = p_product_id
  on conflict (product_id, country_code) do update set
    slug = excluded.slug,
    name = excluded.name,
    name_unaccent = excluded.name_unaccent,
    brand_name = excluded.brand_name,
    brand_slug = excluded.brand_slug,
    gender_slug = excluded.gender_slug,
    family_slug = excluded.family_slug,
    concentration_slug = excluded.concentration_slug,
    category_ids = excluded.category_ids,
    min_price = excluded.min_price,
    max_price = excluded.max_price,
    compare_at_price = excluded.compare_at_price,
    discount_pct = excluded.discount_pct,
    in_stock = excluded.in_stock,
    variant_count = excluded.variant_count,
    img_primary = excluded.img_primary,
    img_hover = excluded.img_hover,
    badges = excluded.badges,
    rating_avg = excluded.rating_avg,
    rating_count = excluded.rating_count,
    sales_30d = excluded.sales_30d,
    sort_featured = excluded.sort_featured,
    published_at = excluded.published_at,
    is_visible = excluded.is_visible,
    search_tsv = excluded.search_tsv;
end;
$$;
comment on function public.refresh_catalog_listing(uuid) is
  'Recalcula las filas de catalog_listing de un producto (inserta/actualiza por país y borra países que ya no aplican). Idempotente.';

create or replace function public.refresh_catalog_listing_many(p_product_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in select distinct u from unnest(p_product_ids) as u where u is not null loop
    perform public.refresh_catalog_listing(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.refresh_catalog_listing_all()
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.catalog_listing cl
  where not exists (
    select 1 from public.product_countries pc
    where pc.product_id = cl.product_id and pc.country_code = cl.country_code);
  select public.refresh_catalog_listing_many(array(select p.id from public.products p)) into v_n;
  return v_n;
end;
$$;
comment on function public.refresh_catalog_listing_all() is 'Refresco completo (job nocturno y fin de importación).';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.catalog_listing_on_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_ids uuid[];
begin
  if coalesce(current_setting('izao.skip_catalog_refresh', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'products' then
    v_ids := array[(v_new->>'id')::uuid, (v_old->>'id')::uuid];
  elsif tg_table_name in ('product_countries', 'product_images', 'product_categories', 'product_variants') then
    v_ids := array[(v_new->>'product_id')::uuid, (v_old->>'product_id')::uuid];
  elsif tg_table_name = 'variant_countries' then
    select array_agg(v.product_id) into v_ids
    from public.product_variants v
    where v.id in ((v_new->>'variant_id')::uuid, (v_old->>'variant_id')::uuid);
  elsif tg_table_name = 'reviews' then
    -- solo cuando la reseña está o estuvo aprobada
    if coalesce(v_new->>'status', '') = 'approved' or coalesce(v_old->>'status', '') = 'approved' then
      v_ids := array[(v_new->>'product_id')::uuid, (v_old->>'product_id')::uuid];
    end if;
  end if;

  if v_ids is not null then
    perform public.refresh_catalog_listing_many(v_ids);
  end if;
  return null;
end;
$$;

-- Cambios en tablas relacionadas que afectan a muchos productos (nombres, slugs, imágenes, jerarquía)
create or replace function public.catalog_listing_on_related_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_ids uuid[];
begin
  if coalesce(current_setting('izao.skip_catalog_refresh', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'brands' then
    select array_agg(p.id) into v_ids from public.products p where p.brand_id = new.id;
  elsif tg_table_name = 'genders' then
    select array_agg(p.id) into v_ids from public.products p where p.gender_id = new.id;
  elsif tg_table_name = 'olfactory_families' then
    select array_agg(p.id) into v_ids from public.products p where p.family_id = new.id;
  elsif tg_table_name = 'concentrations' then
    select array_agg(p.id) into v_ids from public.products p where p.concentration_id = new.id;
  elsif tg_table_name = 'media' then
    select array_agg(pi.product_id) into v_ids from public.product_images pi where pi.media_id = new.id;
  elsif tg_table_name = 'categories' then
    select array_agg(pcat.product_id) into v_ids
    from public.product_categories pcat
    join public.categories cat on cat.id = pcat.category_id
    where cat.id = new.id or cat.parent_id = new.id;
  end if;

  if v_ids is not null then
    perform public.refresh_catalog_listing_many(v_ids);
  end if;
  return null;
end;
$$;

create trigger catalog_listing_refresh after insert or update or delete on public.products
  for each row execute function public.catalog_listing_on_change();
create trigger catalog_listing_refresh after insert or update or delete on public.product_countries
  for each row execute function public.catalog_listing_on_change();
create trigger catalog_listing_refresh after insert or update or delete on public.variant_countries
  for each row execute function public.catalog_listing_on_change();
create trigger catalog_listing_refresh after insert or update or delete on public.product_images
  for each row execute function public.catalog_listing_on_change();
create trigger catalog_listing_refresh after insert or update or delete on public.product_categories
  for each row execute function public.catalog_listing_on_change();
create trigger catalog_listing_refresh after update of product_id or delete on public.product_variants
  for each row execute function public.catalog_listing_on_change();
create trigger catalog_listing_refresh after insert or update or delete on public.reviews
  for each row execute function public.catalog_listing_on_change();

create trigger catalog_listing_refresh after update of name, slug on public.brands
  for each row execute function public.catalog_listing_on_related_change();
create trigger catalog_listing_refresh after update of name, slug on public.genders
  for each row execute function public.catalog_listing_on_related_change();
create trigger catalog_listing_refresh after update of name, slug on public.olfactory_families
  for each row execute function public.catalog_listing_on_related_change();
create trigger catalog_listing_refresh after update of name, slug on public.concentrations
  for each row execute function public.catalog_listing_on_related_change();
create trigger catalog_listing_refresh after update of base_path, variants, lqip, alt, width, height on public.media
  for each row execute function public.catalog_listing_on_related_change();
create trigger catalog_listing_refresh after update of parent_id on public.categories
  for each row execute function public.catalog_listing_on_related_change();

revoke execute on function public.refresh_catalog_listing(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_catalog_listing_many(uuid[]) from public, anon, authenticated;
revoke execute on function public.refresh_catalog_listing_all() from public, anon, authenticated;
revoke execute on function public.catalog_listing_on_change() from public, anon, authenticated;
revoke execute on function public.catalog_listing_on_related_change() from public, anon, authenticated;
