-- Fixture: esquema `auth` representativo de GoTrue (Supabase Auth), solo estructura.
-- Reproduce las tablas, tipos enumerados y llaves foráneas que importan para respaldar y restaurar
-- (columnas reducidas a las relevantes; las FK y el orden de dependencias son los reales).
-- Se usa en test-backup-restore.sh. NO es un volcado literal: la restauración contra un esquema
-- auth real de Supabase sigue pendiente de verificar.

create schema if not exists auth;

create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
create type auth.code_challenge_method as enum ('s256', 'plain');
create type auth.factor_status as enum ('unverified', 'verified');
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.one_time_token_type as enum (
  'confirmation_token', 'reauthentication_token', 'recovery_token',
  'email_change_token_new', 'email_change_token_current', 'phone_change_token'
);

create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

create table auth.schema_migrations (version varchar(255) primary key);

create table auth.instances (
  id uuid primary key,
  raw_base_config text,
  created_at timestamptz,
  updated_at timestamptz
);

create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  phone text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_anonymous boolean not null default false
);
create unique index users_email_idx on auth.users (email);

create table auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  created_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  unique (provider_id, provider)
);

create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  factor_id uuid,
  aal auth.aal_level,
  not_after timestamptz,
  user_agent text,
  ip inet
);

create table auth.refresh_tokens (
  instance_id uuid,
  id bigserial primary key,
  token varchar(255) unique,
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade
);

create table auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null,
  status auth.factor_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  secret text
);

create table auth.mfa_challenges (
  id uuid primary key,
  factor_id uuid not null references auth.mfa_factors (id) on delete cascade,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  ip_address inet not null
);

create table auth.mfa_amr_claims (
  session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  authentication_method text not null,
  id uuid primary key,
  constraint mfa_amr_claims_session_id_authentication_method_pkey unique (session_id, authentication_method)
);

create table auth.flow_state (
  id uuid primary key,
  user_id uuid,
  auth_code text not null,
  code_challenge_method auth.code_challenge_method not null,
  code_challenge text not null,
  provider_type text not null,
  created_at timestamptz
);

create table auth.sso_providers (
  id uuid primary key,
  resource_id text,
  created_at timestamptz
);

create table auth.saml_relay_states (
  id uuid primary key,
  sso_provider_id uuid not null references auth.sso_providers (id) on delete cascade,
  request_id text not null,
  for_email text,
  redirect_to text,
  created_at timestamptz,
  flow_state_id uuid references auth.flow_state (id) on delete cascade
);

create table auth.one_time_tokens (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_type auth.one_time_token_type not null,
  token_hash text not null,
  relates_to text not null,
  created_at timestamp not null default now()
);

create table auth.audit_log_entries (
  instance_id uuid,
  id uuid primary key,
  payload json,
  created_at timestamptz,
  ip_address varchar(64) not null default ''
);
