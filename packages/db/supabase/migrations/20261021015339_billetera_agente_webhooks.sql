-- D-027 (izao-logistica): saldo de la billetera de la transportadora por país, configuración remota del agente de
-- impresión y suscripciones de webhooks de proveedores (idProductWebhook de MasterShop).

-- 1. Billetera de la transportadora en country_settings (job mastershop.billetera).
alter table public.country_settings
  add column carrier_wallet_low_balance bigint
    constraint country_settings_carrier_wallet_low_balance_check check (carrier_wallet_low_balance >= 0),
  add column carrier_wallet_balance bigint,
  add column carrier_wallet_balance_at timestamptz,
  add column carrier_wallet_low_alert_at timestamptz;

comment on column public.country_settings.carrier_wallet_low_balance is
  'Umbral de saldo bajo de la billetera de la transportadora, en unidad menor de la moneda del país. null = sin alerta. Editable en el panel.';
comment on column public.country_settings.carrier_wallet_balance is
  'Último saldo leído de la billetera (newBalance del movimiento más reciente), en unidad menor. Lo escribe el job mastershop.billetera.';
comment on column public.country_settings.carrier_wallet_balance_at is
  'Fecha del movimiento del que sale carrier_wallet_balance.';
comment on column public.country_settings.carrier_wallet_low_alert_at is
  'Momento en que se disparó la alerta de saldo bajo vigente; null = sin alerta activa (se rearma al recuperarse).';

-- Valor por defecto del seed para Colombia (solo si aún no tiene umbral).
update public.country_settings set carrier_wallet_low_balance = 100000
  where country_code = 'CO' and carrier_wallet_low_balance is null;

-- 2. Configuración remota del agente de impresión (print / panel / intervals), editable desde el panel.
alter table public.print_agents
  add column remote_config jsonb not null default '{}'::jsonb
    constraint print_agents_remote_config_check check (jsonb_typeof(remote_config) = 'object');

comment on column public.print_agents.remote_config is
  'Configuración remota del agente (objeto con print, panel, intervals). {} = valores por defecto del agente.';

-- 3. Suscripciones de webhooks registradas en proveedores. MasterShop no permite listarlas después: se guarda el id
--    que devuelve el registro. La URL no se guarda (lleva el secreto de ruta).
create table public.integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  country_code text references public.countries(code),
  environment text not null constraint integration_webhooks_environment_check check (environment in ('sandbox', 'production')),
  event_id integer not null constraint integration_webhooks_event_id_check check (event_id > 0),
  event_name text not null,
  external_id bigint not null constraint integration_webhooks_external_id_check check (external_id > 0),
  is_enabled boolean not null default true,
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_webhooks_provider_country_env_event_key unique nulls not distinct (provider, country_code, environment, event_id),
  constraint integration_webhooks_provider_env_external_key unique (provider, environment, external_id)
);

comment on table public.integration_webhooks is
  'Webhooks registrados en proveedores (MasterShop: event_id = idWebhook, external_id = idProductWebhook). Solo servidor.';

create index integration_webhooks_country_code_idx on public.integration_webhooks (country_code);

alter table public.integration_webhooks enable row level security;
create trigger set_updated_at before update on public.integration_webhooks
  for each row execute function public.set_updated_at();

revoke all on public.integration_webhooks from anon, authenticated;
