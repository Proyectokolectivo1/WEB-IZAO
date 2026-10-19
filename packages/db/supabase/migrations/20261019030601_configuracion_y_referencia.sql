-- 0002 · Configuración y referencia (§6.2) + media (compartida por catálogo y contenido)
-- RLS activo en todas las tablas, sin políticas (denegado por defecto).

create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  exponent smallint not null check (exponent between 0 and 4),
  symbol text not null,
  format_pattern text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.currencies is 'Monedas. exponent = decimales de la unidad menor (COP 0, USD 2).';

create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null,
  currency_code text not null references public.currencies (code),
  locale text not null,
  timezone text not null,
  is_active boolean not null default true,
  phone_prefix text not null check (phone_prefix ~ '^\+[0-9]{1,4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index countries_currency_code_idx on public.countries (currency_code);

create table public.country_settings (
  country_code text primary key references public.countries (code) on delete cascade,
  cod_enabled boolean not null default false,
  cod_deposit_amount bigint not null default 0 check (cod_deposit_amount >= 0),
  cod_min_collect_amount bigint not null default 0 check (cod_min_collect_amount >= 0),
  cod_link_ttl_hours integer not null default 24 check (cod_link_ttl_hours > 0),
  cod_reminder_offsets_minutes integer[] not null default '{180,720,1260}',
  cod_quiet_hours_start time not null default '21:00',
  cod_quiet_hours_end time not null default '07:00',
  financing_surcharge_pct jsonb not null default '{"addi":10,"sistecredito":10}'::jsonb
    check (jsonb_typeof(financing_surcharge_pct) = 'object'),
  pending_payment_ttl_minutes integer not null default 60 check (pending_payment_ttl_minutes > 0),
  manual_order_ttl_hours integer not null default 24 check (manual_order_ttl_hours > 0),
  advisor_whatsapp text,
  support_email extensions.citext,
  announcement_rotation_seconds integer not null default 4 check (announcement_rotation_seconds > 0),
  -- Tasa (no es un monto): COP por 1 unidad mayor de la moneda del país. null = [COMPLETAR].
  fx_rate_to_cop numeric(18,6) check (fx_rate_to_cop is null or fx_rate_to_cop > 0),
  carrier_provider text check (carrier_provider in ('mastershop')),
  carrier_auto_confirm boolean not null default true,
  -- A = additional_charge negativo; B = prorrateo por línea (§14.4)
  carrier_discount_mode text not null default 'prorate'
    check (carrier_discount_mode in ('additional_charge', 'prorate')),
  shipping_cost_estimate bigint not null default 0 check (shipping_cost_estimate >= 0),
  hide_out_of_stock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.country_settings.cod_quiet_hours_start is 'Inicio del horario silencioso de cobros por WhatsApp (§13.1).';
comment on column public.country_settings.carrier_discount_mode is 'Modo de cuadre del total en MasterShop: additional_charge (A) o prorate (B).';
comment on column public.country_settings.manual_order_ttl_hours is 'Reserva de stock de pedidos pendiente_manual (§5.4, D-002).';

create table public.media (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product','banner','site','category','review','warranty')),
  base_path text not null,
  original_name text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  variants jsonb not null default '{}'::jsonb,
  lqip text,
  alt text,
  bytes bigint check (bytes is null or bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_kind_idx on public.media (kind);

create table public.site_settings (
  id boolean primary key default true check (id),
  store_name text not null,
  logo_media_id uuid references public.media (id) on delete set null,
  favicon_media_id uuid references public.media (id) on delete set null,
  og_image_media_id uuid references public.media (id) on delete set null,
  color_tokens jsonb not null default '{}'::jsonb,
  typography jsonb not null default '{}'::jsonb,
  social_links jsonb not null default '{}'::jsonb,
  legal_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.site_settings is 'Fila única (id = true): marca, tokens de color, tipografía, redes y datos legales base.';
create index site_settings_logo_media_id_idx on public.site_settings (logo_media_id);
create index site_settings_favicon_media_id_idx on public.site_settings (favicon_media_id);
create index site_settings_og_image_media_id_idx on public.site_settings (og_image_media_id);

create table public.theme_overrides (
  country_code text primary key references public.countries (code) on delete cascade,
  tokens jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  name text not null,
  code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, code)
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete cascade,
  name text not null,
  code text not null,
  is_capital boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (region_id, code)
);

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  country_code text references public.countries (code),
  environment text not null check (environment in ('sandbox','production')),
  data_encrypted bytea not null,
  iv bytea not null,
  key_version smallint not null default 1,
  masked_preview jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_credentials_provider_country_env_key
    unique nulls not distinct (provider, country_code, environment)
);
comment on table public.integration_credentials is 'Credenciales AES-256-GCM (§26.3). country_code null = global (p. ej. OpenRouter).';
create index integration_credentials_country_code_idx on public.integration_credentials (country_code);

create table public.payment_method_settings (
  country_code text not null references public.countries (code) on delete cascade,
  method text not null check (method in ('wompi','addi','sistecredito','cod')),
  is_enabled boolean not null default false,
  sort_order integer not null default 0,
  display_name text not null,
  description text,
  fee_pct numeric(6,3) not null default 0 check (fee_pct >= 0),
  fee_fixed bigint not null default 0 check (fee_fixed >= 0),
  fee_tax_pct numeric(6,3) not null default 0 check (fee_tax_pct >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (country_code, method)
);

-- RLS
alter table public.currencies enable row level security;
alter table public.countries enable row level security;
alter table public.country_settings enable row level security;
alter table public.media enable row level security;
alter table public.site_settings enable row level security;
alter table public.theme_overrides enable row level security;
alter table public.regions enable row level security;
alter table public.cities enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.payment_method_settings enable row level security;

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['currencies','countries','country_settings','media','site_settings',
    'theme_overrides','regions','cities','integration_credentials','payment_method_settings']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
