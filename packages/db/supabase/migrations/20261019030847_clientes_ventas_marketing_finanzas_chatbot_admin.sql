-- 0004 · Clientes, ventas, descuentos y marketing, postventa y finanzas, chatbot, administración (§6.2)
-- RLS activo en todas las tablas. Únicas políticas: cliente autenticado sobre lo suyo (§6.1).

-- ---------------------------------------------------------------------------
-- Numeración por país (orders.number IZ-CO-000123, warranty_claims.number GAR-CO-0001)
-- ---------------------------------------------------------------------------
create table public.number_sequences (
  kind text not null check (kind in ('order','warranty')),
  country_code text not null references public.countries (code) on delete cascade,
  last_value bigint not null default 0 check (last_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, country_code)
);
create index number_sequences_country_code_idx on public.number_sequences (country_code);

create or replace function public.next_document_number(p_kind text, p_country_code text)
returns bigint
language sql
volatile
set search_path = ''
as $$
  insert into public.number_sequences as s (kind, country_code, last_value)
  values (p_kind, p_country_code, 1)
  on conflict (kind, country_code) do update set last_value = s.last_value + 1
  returning s.last_value;
$$;
comment on function public.next_document_number(text, text) is
  'Siguiente consecutivo por (tipo, país). Atómico: bloquea la fila del contador hasta el commit.';
revoke execute on function public.next_document_number(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Descuentos y marketing
-- ---------------------------------------------------------------------------
create table public.influencers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text,
  country_code text not null references public.countries (code),
  phone text,
  email extensions.citext,
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index influencers_country_code_idx on public.influencers (country_code);

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code = upper(code) and code ~ '^[A-Z0-9_-]+$'),
  country_code text not null references public.countries (code),
  type text not null check (type in ('percent','fixed')),
  -- percent: porcentaje entero 1–100; fixed: monto en unidad menor
  value bigint not null check (value > 0),
  max_discount_amount bigint check (max_discount_amount is null or max_discount_amount > 0),
  min_subtotal bigint not null default 0 check (min_subtotal >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit_total integer check (usage_limit_total is null or usage_limit_total > 0),
  usage_limit_per_customer integer check (usage_limit_per_customer is null or usage_limit_per_customer > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  applies_to text not null default 'all' check (applies_to in ('all','categories','products')),
  target_ids uuid[] not null default '{}',
  exclude_ids uuid[] not null default '{}',
  applies_to_sale_items boolean not null default true,
  influencer_id uuid references public.influencers (id) on delete set null,
  origin text not null default 'manual' check (origin in ('manual','popup','batch')),
  parent_code_id uuid references public.discount_codes (id) on delete set null,
  iza_can_offer boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'percent' or value between 1 and 100),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (applies_to = 'all' or cardinality(target_ids) > 0)
);
comment on column public.discount_codes.iza_can_offer is 'El chatbot solo menciona códigos marcados así (§17.1).';
-- §6.3
create unique index discount_codes_upper_code_idx on public.discount_codes (upper(code));
create index discount_codes_influencer_id_idx on public.discount_codes (influencer_id);
create index discount_codes_parent_code_id_idx on public.discount_codes (parent_code_id);
create index discount_codes_country_code_idx on public.discount_codes (country_code);

alter table public.popups
  add constraint popups_discount_code_id_fkey
  foreign key (discount_code_id) references public.discount_codes (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  country_code text not null references public.countries (code),
  first_name text,
  last_name text,
  email extensions.citext,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  document_type text,
  document_number text,
  marketing_opt_in boolean not null default false,
  whatsapp_opt_in boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_email_idx on public.customers (email);
create index customers_phone_e164_idx on public.customers (phone_e164);
create index customers_document_idx on public.customers (document_number);
create index customers_country_code_idx on public.customers (country_code);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  region_id uuid references public.regions (id),
  city_id uuid references public.cities (id),
  district text,
  address1 text not null,
  address2 text,
  zip text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_customer_id_idx on public.addresses (customer_id);
create index addresses_region_id_idx on public.addresses (region_id);
create index addresses_city_id_idx on public.addresses (city_id);
create unique index addresses_one_default_idx on public.addresses (customer_id) where is_default;

create table public.wishlists (
  customer_id uuid not null references public.customers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);
create index wishlists_product_id_idx on public.wishlists (product_id);

-- ---------------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null check (number ~ '^[A-Za-z0-9-]+$'),
  country_code text not null references public.countries (code),
  currency_code text not null references public.currencies (code),
  customer_id uuid references public.customers (id) on delete set null,
  -- snapshot de contacto
  contact_first_name text not null,
  contact_last_name text not null,
  contact_phone_e164 text not null,
  contact_email extensions.citext,
  document_type text,
  document_number text,
  -- snapshot de dirección
  shipping_region_id uuid references public.regions (id),
  shipping_city_id uuid references public.cities (id),
  shipping_region_name text,
  shipping_city_name text,
  shipping_district text,
  shipping_address1 text,
  shipping_address2 text,
  shipping_zip text,
  shipping_notes text,
  payment_method text not null check (payment_method in ('wompi','addi','sistecredito','cod','manual')),
  status text not null check (status in (
    'pendiente_pago','pago_rechazado','expirado','esperando_abono','abandonado','pendiente_manual',
    'pagado','abono_pagado','error_transportadora','enviado_transportadora','en_preparacion',
    'en_transito','entregado','devuelto','cancelado','reclamacion','requiere_reembolso')),
  subtotal bigint not null check (subtotal >= 0),
  discount_code_id uuid references public.discount_codes (id) on delete set null,
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  financing_surcharge_pct numeric(5,2) not null default 0 check (financing_surcharge_pct >= 0),
  financing_surcharge_amount bigint not null default 0 check (financing_surcharge_amount >= 0),
  total_customer bigint not null check (total_customer >= 0),
  cod_deposit_amount bigint not null default 0 check (cod_deposit_amount >= 0),
  cod_collect_amount bigint not null default 0 check (cod_collect_amount >= 0),
  shipping_cost_real bigint check (shipping_cost_real is null or shipping_cost_real >= 0),
  gateway_fee_estimated bigint not null default 0 check (gateway_fee_estimated >= 0),
  carrier_fees jsonb not null default '{}'::jsonb,
  product_cost_total bigint not null default 0 check (product_cost_total >= 0),
  influencer_id uuid references public.influencers (id) on delete set null,
  utm jsonb not null default '{}'::jsonb,
  click_ids jsonb not null default '{}'::jsonb,
  public_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  checkout_idempotency_key text,
  alerts jsonb not null default '[]'::jsonb,
  stock_reserved_until timestamptz,
  abandoned_at timestamptz,
  paid_at timestamptz,
  sent_to_carrier_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  notes_internal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_check check (total_customer = subtotal - discount_amount + financing_surcharge_amount),
  constraint orders_cod_check check (payment_method <> 'cod' or cod_collect_amount = total_customer - cod_deposit_amount),
  constraint orders_public_token_key unique (public_token),
  constraint orders_checkout_idempotency_key_key unique (checkout_idempotency_key)
);
comment on column public.orders.number is 'IZ-{PAÍS}-000123, asignado por trigger. Solo letras, números y guiones (MasterShop).';
comment on column public.orders.total_customer is 'subtotal − descuento + recargo (envío siempre 0). §11.2';
-- §6.3
create unique index orders_number_idx on public.orders (number);
create index orders_country_status_created_idx on public.orders (country_code, status, created_at desc);
create index orders_country_paid_at_idx on public.orders (country_code, paid_at);
create index orders_payment_method_status_idx on public.orders (payment_method, status);
create index orders_customer_id_idx on public.orders (customer_id);
create index orders_discount_code_id_idx on public.orders (discount_code_id);
create index orders_influencer_id_idx on public.orders (influencer_id);
-- adicionales
create index orders_contact_phone_idx on public.orders (contact_phone_e164);
create index orders_shipping_city_id_idx on public.orders (shipping_city_id);
create index orders_shipping_region_id_idx on public.orders (shipping_region_id);
create index orders_currency_code_idx on public.orders (currency_code);
create index orders_stock_reserved_until_idx on public.orders (stock_reserved_until)
  where status in ('pendiente_pago','esperando_abono','pendiente_manual');

create or replace function public.assign_order_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v text;
begin
  if new.number is null then
    v := public.next_document_number('order', new.country_code)::text;
    if length(v) < 6 then v := lpad(v, 6, '0'); end if;
    new.number := 'IZ-' || new.country_code || '-' || v;
  end if;
  return new;
end;
$$;
revoke execute on function public.assign_order_number() from public, anon, authenticated;
create trigger assign_order_number before insert on public.orders
  for each row execute function public.assign_order_number();

alter table public.reviews
  add constraint reviews_order_id_fkey foreign key (order_id) references public.orders (id) on delete set null;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  email extensions.citext,
  phone_e164 text,
  popup_id uuid references public.popups (id) on delete set null,
  discount_code_id uuid references public.discount_codes (id) on delete set null,
  consent_at timestamptz not null default now(),
  consent_text_version text not null,
  marketing_opt_in boolean not null default false,
  utm jsonb not null default '{}'::jsonb,
  converted_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone_e164 is not null)
);
create index leads_country_phone_idx on public.leads (country_code, phone_e164);
create index leads_country_email_idx on public.leads (country_code, email);
create index leads_popup_id_idx on public.leads (popup_id);
create index leads_discount_code_id_idx on public.leads (discount_code_id);
create index leads_converted_order_id_idx on public.leads (converted_order_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  sku text not null,
  name_snapshot text not null,
  variant_label text,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  unit_compare_at bigint check (unit_compare_at is null or unit_compare_at >= 0),
  unit_cost bigint check (unit_cost is null or unit_cost >= 0),
  line_discount bigint not null default 0 check (line_discount >= 0),
  weight_kg numeric(8,3),
  mastershop_product_id integer,
  mastershop_variant_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);
create index order_items_variant_id_idx on public.order_items (variant_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  type text not null,
  from_status text,
  to_status text,
  payload jsonb not null default '{}'::jsonb,
  actor text not null check (actor ~ '^(system|agent|admin:.+|webhook:.+)$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_events_order_id_idx on public.order_events (order_id, created_at);

create table public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_key text not null,
  amount bigint not null check (amount >= 0),
  status text not null default 'reserved' check (status in ('reserved','confirmed','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discount_code_id, order_id)
);
create index discount_redemptions_code_customer_idx on public.discount_redemptions (discount_code_id, customer_key) where status <> 'released';
create index discount_redemptions_order_id_idx on public.discount_redemptions (order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null,
  purpose text not null check (purpose in ('full','cod_deposit','financing')),
  amount bigint not null check (amount >= 0),
  currency_code text not null references public.currencies (code),
  status text not null default 'created' check (status in ('created','pending','approved','declined','voided','error','expired')),
  provider_reference text,
  provider_transaction_id text,
  payment_link_id text,
  checkout_url text,
  expires_at timestamptz,
  fee_amount bigint check (fee_amount is null or fee_amount >= 0),
  raw_last_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- §6.3
create index payments_order_id_idx on public.payments (order_id);
create unique index payments_provider_transaction_idx on public.payments (provider, provider_transaction_id) where provider_transaction_id is not null;
create index payments_payment_link_id_idx on public.payments (payment_link_id);
create index payments_provider_reference_idx on public.payments (provider_reference);
create index payments_currency_code_idx on public.payments (currency_code);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  signature_valid boolean,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.webhook_events is 'Idempotencia de webhooks. Retención 90 días (job).';
-- §6.3
create unique index webhook_events_provider_event_idx on public.webhook_events (provider, event_id);
create index webhook_events_created_at_idx on public.webhook_events (created_at);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null default 'mastershop' check (provider in ('mastershop')),
  external_order_id text not null,
  provider_order_id integer,
  provider_status_id integer,
  provider_status_name text,
  provider_status_parent text,
  carrier_name text,
  tracking_code text,
  tracking_url text,
  label_url text,
  label_local_path text,
  has_novelty boolean not null default false,
  alerts jsonb not null default '[]'::jsonb,
  shipping_rate bigint check (shipping_rate is null or shipping_rate >= 0),
  total_provider bigint check (total_provider is null or total_provider >= 0),
  last_synced_at timestamptz,
  status_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, provider)
);
-- §6.3
create index shipments_provider_status_id_idx on public.shipments (provider_status_id);
create index shipments_provider_order_id_idx on public.shipments (provider_order_id);
create index shipments_external_order_id_idx on public.shipments (external_order_id);

create table public.print_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  last_heartbeat_at timestamptz,
  version text,
  printer_name text,
  mode text not null default 'api' check (mode in ('api','panel')),
  status_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  shipment_id uuid references public.shipments (id) on delete cascade,
  type text not null default 'label' check (type in ('label','packing_list','test_page')),
  status text not null default 'queued' check (status in ('queued','claimed','printed','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_by_agent uuid references public.print_agents (id) on delete set null,
  claimed_at timestamptz,
  printed_at timestamptz,
  error text,
  requested_by text not null default 'auto' check (requested_by ~ '^(auto|admin:.+)$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type = 'test_page' or order_id is not null)
);
-- §6.3
create index print_jobs_status_created_idx on public.print_jobs (status, created_at);
create index print_jobs_order_id_idx on public.print_jobs (order_id);
create index print_jobs_shipment_id_idx on public.print_jobs (shipment_id);
create index print_jobs_claimed_by_agent_idx on public.print_jobs (claimed_by_agent);

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  country_code text not null references public.countries (code) on delete cascade,
  meta_template_name text not null,
  meta_template_id text,
  category text not null default 'UTILITY' check (category in ('UTILITY','MARKETING','AUTHENTICATION')),
  language text not null default 'es',
  body_text text not null,
  footer_text text,
  button_text text,
  button_url text,
  variables_map jsonb not null default '{}'::jsonb,
  meta_status text not null default 'draft' check (meta_status in ('draft','pending','approved','rejected','paused')),
  meta_rejection_reason text,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, country_code, version)
);
create unique index whatsapp_templates_one_active_idx on public.whatsapp_templates (key, country_code) where is_active;
create index whatsapp_templates_country_code_idx on public.whatsapp_templates (country_code);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  template_id uuid references public.whatsapp_templates (id) on delete set null,
  to_e164 text not null,
  wa_message_id text unique,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed')),
  error_code text,
  error_text text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- §6.3
create index whatsapp_messages_status_scheduled_idx on public.whatsapp_messages (status, scheduled_for);
create index whatsapp_messages_order_id_idx on public.whatsapp_messages (order_id);
create index whatsapp_messages_template_id_idx on public.whatsapp_messages (template_id);

create table public.pay_links (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{6,64}$'),
  order_id uuid not null references public.orders (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  target_url text not null,
  expires_at timestamptz not null,
  clicks integer not null default 0 check (clicks >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pay_links_order_id_idx on public.pay_links (order_id);
create index pay_links_payment_id_idx on public.pay_links (payment_id);

-- ---------------------------------------------------------------------------
-- Postventa y finanzas
-- ---------------------------------------------------------------------------
create table public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^[A-Za-z0-9-]+$'),
  order_id uuid references public.orders (id) on delete set null,
  country_code text not null references public.countries (code),
  customer_name text not null,
  phone text not null,
  email extensions.citext,
  reason text not null,
  description text,
  media_ids uuid[] not null default '{}',
  status text not null default 'recibida' check (status in ('recibida','en_revision','aprobada','rechazada','resuelta')),
  resolution text check (resolution in ('reenvio','cambio','reembolso','otro')),
  cost_amount bigint not null default 0 check (cost_amount >= 0),
  admin_notes text,
  status_history jsonb not null default '[]'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index warranty_claims_order_id_idx on public.warranty_claims (order_id);
create index warranty_claims_country_status_idx on public.warranty_claims (country_code, status, created_at desc);

create or replace function public.assign_warranty_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v text;
begin
  if new.number is null then
    v := public.next_document_number('warranty', new.country_code)::text;
    if length(v) < 4 then v := lpad(v, 4, '0'); end if;
    new.number := 'GAR-' || new.country_code || '-' || v;
  end if;
  return new;
end;
$$;
revoke execute on function public.assign_warranty_number() from public, anon, authenticated;
create trigger assign_warranty_number before insert on public.warranty_claims
  for each row execute function public.assign_warranty_number();

create table public.warranty_settings (
  country_code text primary key references public.countries (code) on delete cascade,
  period_days integer not null default 30 check (period_days > 0),
  response_days integer not null default 5 check (response_days > 0),
  reasons text[] not null default '{}',
  instructions_html text not null default '',
  conditions_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  category_id uuid not null references public.expense_categories (id),
  date date not null,
  amount bigint not null check (amount >= 0),
  currency_code text not null references public.currencies (code),
  description text,
  source text not null default 'manual' check (source in ('manual','meta_ads','mastershop_wallet')),
  external_ref text,
  attachment_media_id uuid references public.media (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index expenses_source_external_ref_idx on public.expenses (source, external_ref) where external_ref is not null;
create index expenses_country_date_idx on public.expenses (country_code, date);
create index expenses_category_id_idx on public.expenses (category_id);
create index expenses_currency_code_idx on public.expenses (currency_code);
create index expenses_attachment_media_id_idx on public.expenses (attachment_media_id);

-- §21.4: agregados por fecha (America/Bogota), país y método
create table public.daily_sales_stats (
  date date not null,
  country_code text not null references public.countries (code),
  payment_method text not null check (payment_method in ('wompi','addi','sistecredito','cod','manual')),
  currency_code text not null references public.currencies (code),
  orders_created integer not null default 0,
  orders_paid integer not null default 0,
  gross_sales bigint not null default 0,
  discounts bigint not null default 0,
  surcharges bigint not null default 0,
  cod_deposits bigint not null default 0,
  cod_collect_sent bigint not null default 0,
  prepaid_sent_value bigint not null default 0,
  delivered_count integer not null default 0,
  delivered_value bigint not null default 0,
  returned_count integer not null default 0,
  returned_value bigint not null default 0,
  cod_deposits_returned bigint not null default 0,
  gateway_fees bigint not null default 0,
  product_cost bigint not null default 0,
  shipping_cost bigint not null default 0,
  warranty_cost bigint not null default 0,
  recalculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date, country_code, payment_method)
);
create index daily_sales_stats_country_date_idx on public.daily_sales_stats (country_code, date);
create index daily_sales_stats_currency_code_idx on public.daily_sales_stats (currency_code);

create table public.daily_traffic_stats (
  date date not null,
  country_code text not null references public.countries (code),
  sessions bigint not null default 0,
  product_views bigint not null default 0,
  add_to_cart bigint not null default 0,
  checkout_started bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date, country_code)
);
create index daily_traffic_stats_country_date_idx on public.daily_traffic_stats (country_code, date);

-- ---------------------------------------------------------------------------
-- Chatbot (costos en micro-USD, bigint)
-- ---------------------------------------------------------------------------
create table public.chat_settings (
  id boolean primary key default true check (id),
  provider text not null default 'openrouter' check (provider in ('openrouter')),
  model_primary text,
  model_fallback text,
  monthly_budget_usd_micros bigint not null default 10000000 check (monthly_budget_usd_micros >= 0),
  degrade_at_pct integer not null default 80 check (degrade_at_pct between 1 and 100),
  extra_instructions text,
  welcome_message jsonb not null default '{}'::jsonb,
  max_output_tokens integer not null default 450 check (max_output_tokens > 0),
  history_turns integer not null default 12 check (history_turns > 0),
  max_input_chars integer not null default 500 check (max_input_chars > 0),
  max_messages_per_session integer not null default 30 check (max_messages_per_session > 0),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.chat_settings.monthly_budget_usd_micros is 'Presupuesto mensual en micro-USD (10.000.000 = USD 10).';
comment on column public.chat_settings.welcome_message is 'Mensaje de bienvenida por país: {"CO": "...", "EC": "..."}';

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code),
  visitor_id text not null,
  customer_id uuid references public.customers (id) on delete set null,
  started_at timestamptz not null default now(),
  last_message_at timestamptz,
  messages_count integer not null default 0 check (messages_count >= 0),
  converted_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_sessions_visitor_id_idx on public.chat_sessions (visitor_id);
create index chat_sessions_country_started_idx on public.chat_sessions (country_code, started_at desc);
create index chat_sessions_customer_id_idx on public.chat_sessions (customer_id);
create index chat_sessions_converted_order_id_idx on public.chat_sessions (converted_order_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text,
  tool_calls jsonb,
  model text,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.chat_messages is 'Retención 180 días (job).';
create index chat_messages_session_created_idx on public.chat_messages (session_id, created_at);
create index chat_messages_created_at_idx on public.chat_messages (created_at);

create table public.chat_usage_monthly (
  month date primary key check (extract(day from month) = 1),
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  messages integer not null default 0 check (messages >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Administración
-- ---------------------------------------------------------------------------
create table public.admin_users (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin','operator')),
  name text not null,
  is_active boolean not null default true,
  mfa_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS + updated_at
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['number_sequences','influencers','discount_codes','customers','addresses',
    'wishlists','orders','leads','order_items','order_events','discount_redemptions','payments',
    'webhook_events','shipments','print_agents','print_jobs','whatsapp_templates','whatsapp_messages',
    'pay_links','warranty_claims','warranty_settings','expense_categories','expenses','daily_sales_stats',
    'daily_traffic_stats','chat_settings','chat_sessions','chat_messages','chat_usage_monthly',
    'admin_users','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios por columna para clientes autenticados (§6.1, decisión 3)
-- El rol anon no tiene acceso a datos de clientes ni pedidos.
-- ---------------------------------------------------------------------------
revoke all on public.customers, public.addresses, public.wishlists, public.orders, public.order_items from anon;
revoke all on public.customers, public.addresses, public.wishlists, public.orders, public.order_items from authenticated;

grant select on public.customers to authenticated;
grant update (first_name, last_name, phone_e164, document_type, document_number, marketing_opt_in, whatsapp_opt_in)
  on public.customers to authenticated;
grant select on public.addresses to authenticated;
grant select on public.wishlists to authenticated;
grant select (
  id, number, country_code, currency_code, customer_id,
  contact_first_name, contact_last_name, contact_phone_e164, contact_email, document_type, document_number,
  shipping_region_id, shipping_city_id, shipping_region_name, shipping_city_name, shipping_district,
  shipping_address1, shipping_address2, shipping_zip, shipping_notes,
  payment_method, status, subtotal, discount_amount, financing_surcharge_pct, financing_surcharge_amount,
  total_customer, cod_deposit_amount, cod_collect_amount, public_token,
  stock_reserved_until, abandoned_at, paid_at, sent_to_carrier_at, delivered_at, cancelled_at,
  created_at, updated_at
) on public.orders to authenticated;
grant select (
  id, order_id, product_id, variant_id, sku, name_snapshot, variant_label, quantity,
  unit_price, unit_compare_at, line_discount, created_at, updated_at
) on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- Políticas: cliente autenticado lee lo suyo y escribe su perfil
-- ---------------------------------------------------------------------------
create policy customers_select_own on public.customers
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy customers_update_own on public.customers
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

create policy addresses_select_own on public.addresses
  for select to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = addresses.customer_id and c.auth_user_id = (select auth.uid())));

create policy wishlists_select_own on public.wishlists
  for select to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = wishlists.customer_id and c.auth_user_id = (select auth.uid())));

create policy orders_select_own on public.orders
  for select to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = orders.customer_id and c.auth_user_id = (select auth.uid())));

create policy order_items_select_own on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.id = order_items.order_id and c.auth_user_id = (select auth.uid())));
