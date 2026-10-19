-- 0001 · Extensiones y utilidades comunes (§6.0, §6.1)
-- Todas las extensiones viven en el esquema `extensions`.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgtap with schema extensions;

-- Mantiene `updated_at` en cada actualización.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE: actualiza updated_at. Se asocia a todas las tablas.';

-- `unaccent` no es IMMUTABLE; este envoltorio sí lo es (diccionario fijo) y
-- permite usarlo en índices y en columnas calculadas.
create or replace function public.f_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text);
$$;

comment on function public.f_unaccent(text) is
  'unaccent() inmutable (diccionario extensions.unaccent). Úsalo para normalizar búsquedas.';

revoke execute on function public.set_updated_at() from public, anon, authenticated;
