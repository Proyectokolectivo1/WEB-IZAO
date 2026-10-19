-- 0003 · Catálogo y contenido (§6.2). RLS activo, sin políticas.
-- Las FK hacia discount_codes (popups) y orders (reviews) se agregan en la 0004.

-- Taxonomías
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  image_id uuid references public.media (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.brands is 'Referencia interna/filtro. No se usan logos de marcas de terceros.';
create index brands_image_id_idx on public.brands (image_id);

create table public.olfactory_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  image_id uuid references public.media (id) on delete set null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index olfactory_families_image_id_idx on public.olfactory_families (image_id);

create table public.genders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.concentrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete restrict,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  seo_title text,
  seo_description text,
  image_id uuid references public.media (id) on delete set null,
  banner_image_id uuid references public.media (id) on delete set null,
  sort_order integer not null default 0,
  show_in_menu boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index categories_parent_id_idx on public.categories (parent_id);
create index categories_image_id_idx on public.categories (image_id);
create index categories_banner_image_id_idx on public.categories (banner_image_id);

-- Máximo 2 niveles: el padre no puede tener padre y una categoría con hijos no puede tener padre.
create or replace function public.enforce_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.categories c where c.id = new.parent_id and c.parent_id is not null) then
      raise exception 'Las categorías admiten máximo 2 niveles (el padre % ya es subcategoría)', new.parent_id
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.categories c where c.parent_id = new.id) then
      raise exception 'Una categoría con subcategorías no puede tener padre'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_category_depth() from public, anon, authenticated;

create trigger enforce_category_depth
  before insert or update of parent_id on public.categories
  for each row execute function public.enforce_category_depth();

create table public.category_countries (
  category_id uuid not null references public.categories (id) on delete cascade,
  country_code text not null references public.countries (code) on delete cascade,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category_id, country_code)
);
create index category_countries_country_code_idx on public.category_countries (country_code);

-- Productos
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  short_description text,
  description_html text,
  brand_id uuid references public.brands (id) on delete set null,
  gender_id uuid references public.genders (id) on delete set null,
  family_id uuid references public.olfactory_families (id) on delete set null,
  concentration_id uuid references public.concentrations (id) on delete set null,
  notes_top text[] not null default '{}',
  notes_heart text[] not null default '{}',
  notes_base text[] not null default '{}',
  occasion text[] not null default '{}',
  season text[] not null default '{}',
  longevity text check (longevity in ('baja','media','alta','muy_alta')),
  sillage text check (sillage in ('baja','media','alta','muy_alta')),
  attributes jsonb not null default '{}'::jsonb,
  seo_title text,
  seo_description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_brand_id_idx on public.products (brand_id);
create index products_gender_id_idx on public.products (gender_id);
create index products_family_id_idx on public.products (family_id);
create index products_concentration_id_idx on public.products (concentration_id);
create index products_status_idx on public.products (status);

create table public.product_categories (
  product_id uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, category_id)
);
create index product_categories_category_id_idx on public.product_categories (category_id);

create table public.product_countries (
  product_id uuid not null references public.products (id) on delete cascade,
  country_code text not null references public.countries (code) on delete cascade,
  is_visible boolean not null default false,
  is_featured boolean not null default false,
  featured_rank integer check (featured_rank is null or featured_rank between 1 and 999999),
  badges text[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, country_code)
);
create index product_countries_country_code_idx on public.product_countries (country_code);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);

create table public.product_option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.product_options (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (option_id, value)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null unique,
  option_value_ids uuid[] not null default '{}',
  weight_kg numeric(8,3) not null default 0.5 check (weight_kg > 0),
  is_default boolean not null default false,
  mastershop_product_id integer,
  mastershop_variant_id integer,
  image_id uuid references public.media (id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_variants_product_id_idx on public.product_variants (product_id);
create index product_variants_image_id_idx on public.product_variants (image_id);
create unique index product_variants_one_default_idx on public.product_variants (product_id) where is_default;

create table public.variant_countries (
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  country_code text not null references public.countries (code) on delete cascade,
  is_active boolean not null default true,
  price bigint not null check (price >= 0),
  compare_at_price bigint check (compare_at_price is null or compare_at_price >= 0),
  cost bigint check (cost is null or cost >= 0),
  stock integer not null default 0 check (stock >= 0),
  stock_reserved integer not null default 0 check (stock_reserved >= 0),
  low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (variant_id, country_code)
);
-- §6.3
create index variant_countries_country_code_variant_id_idx on public.variant_countries (country_code, variant_id);

create table public.product_images (
  product_id uuid not null references public.products (id) on delete cascade,
  media_id uuid not null references public.media (id) on delete cascade,
  sort_order integer not null default 0,
  role text not null default 'gallery' check (role in ('primary','hover','gallery')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, media_id)
);
create index product_images_media_id_idx on public.product_images (media_id);
create unique index product_images_one_primary_idx on public.product_images (product_id) where role = 'primary';
create unique index product_images_one_hover_idx on public.product_images (product_id) where role = 'hover';

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  type text not null default 'manual' check (type in ('manual','rule')),
  rule jsonb,
  sort_order integer not null default 0,
  show_in_home_tabs boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, slug),
  check (type = 'manual' or rule is not null)
);

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection_id, product_id)
);
create index collection_items_product_id_idx on public.collection_items (product_id);

-- Contenido
create table public.banners (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  placement text not null check (placement in ('hero','mid','category')),
  category_id uuid references public.categories (id) on delete cascade,
  desktop_media_id uuid not null references public.media (id) on delete restrict,
  mobile_media_id uuid not null references public.media (id) on delete restrict,
  title text,
  subtitle text,
  cta_label text,
  link_url text,
  alt text not null,
  text_position text not null default 'left' check (text_position in ('left','center','right')),
  text_color text,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (placement <> 'category' or category_id is not null)
);
create index banners_country_placement_idx on public.banners (country_code, placement, sort_order) where is_active;
create index banners_category_id_idx on public.banners (category_id);
create index banners_desktop_media_id_idx on public.banners (desktop_media_id);
create index banners_mobile_media_id_idx on public.banners (mobile_media_id);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  text text not null,
  link_url text,
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_country_code_idx on public.announcements (country_code, sort_order);

create table public.popups (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  name text not null,
  media_id uuid references public.media (id) on delete set null,
  title text,
  body text,
  cta_label text,
  cta_url text,
  capture_lead boolean not null default false,
  lead_reward text check (lead_reward in ('fixed_code','unique_code')),
  discount_code_id uuid,
  unique_code_template jsonb,
  trigger text not null default 'delay' check (trigger in ('delay','exit_intent','scroll_pct')),
  trigger_value integer,
  pages text[] not null default '{all}' check (pages <@ array['home','product','category','all']::text[]),
  frequency text not null default 'once' check (frequency in ('once','per_session','every_n_days')),
  frequency_days integer check (frequency_days is null or frequency_days > 0),
  device text not null default 'all' check (device in ('all','mobile','desktop')),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequency <> 'every_n_days' or frequency_days is not null),
  check (lead_reward is distinct from 'fixed_code' or discount_code_id is not null),
  check (lead_reward is distinct from 'unique_code' or unique_code_template is not null)
);
create index popups_country_code_idx on public.popups (country_code, priority desc) where is_active;
create index popups_media_id_idx on public.popups (media_id);
create index popups_discount_code_id_idx on public.popups (discount_code_id);

create table public.content_slots (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  country_code text references public.countries (code) on delete cascade,
  media_id uuid references public.media (id) on delete set null,
  mobile_media_id uuid references public.media (id) on delete set null,
  title text,
  body text,
  link_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_slots_key_country_key unique nulls not distinct (key, country_code)
);
comment on column public.content_slots.country_code is 'null = espacio global (común a ambos países).';
create index content_slots_country_code_idx on public.content_slots (country_code);
create index content_slots_media_id_idx on public.content_slots (media_id);
create index content_slots_mobile_media_id_idx on public.content_slots (mobile_media_id);

create table public.home_sections (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  type text not null check (type in ('hero','categories','families','collection_tabs','advice','benefits','reviews','banner')),
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index home_sections_country_code_idx on public.home_sections (country_code, sort_order);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  content_html text not null default '',
  seo_title text,
  seo_description text,
  version integer not null default 1 check (version > 0),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, slug)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  author_name text not null,
  city text,
  rating smallint not null check (rating between 1 and 5),
  body text,
  media_ids uuid[] not null default '{}',
  source text not null default 'customer' check (source in ('customer','admin')),
  order_id uuid,
  is_verified_purchase boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  featured_home boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.reviews.product_id is 'null = reseña de la tienda.';
create index reviews_product_country_idx on public.reviews (product_id, country_code) where status = 'approved';
create index reviews_country_home_idx on public.reviews (country_code) where status = 'approved' and featured_home;
create index reviews_status_idx on public.reviews (status, created_at desc);
create index reviews_order_id_idx on public.reviews (order_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['brands','olfactory_families','genders','concentrations','categories',
    'category_countries','products','product_categories','product_countries','product_options',
    'product_option_values','product_variants','variant_countries','product_images','collections',
    'collection_items','banners','announcements','popups','content_slots','home_sections','pages','reviews']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
