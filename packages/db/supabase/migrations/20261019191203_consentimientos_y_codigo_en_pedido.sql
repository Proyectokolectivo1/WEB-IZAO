-- T1.12 · Pruebas de aceptación del checkout (§10.1 paso 6) y copia del código de descuento en el pedido.
-- Aditiva y reversible (drop trigger/function; alter table orders drop column ...).
--   terms_accepted_at   momento en que el cliente aceptó términos y política de datos
--   data_policy_version versión de la política aceptada (texto que define el panel)
--   whatsapp_opt_in     autorización de contacto por WhatsApp dada en el checkout
--   discount_code_text  copia del código usado: se conserva aunque el código se borre (el FK sigue en on delete set null)
-- El cliente no recibe select sobre estas columnas (los privilegios de orders son por columna).

alter table public.orders
  add column terms_accepted_at timestamptz,
  add column data_policy_version text,
  add column whatsapp_opt_in boolean not null default false,
  add column discount_code_text text;
comment on column public.orders.terms_accepted_at is 'Cuándo aceptó términos y política de datos en el checkout.';
comment on column public.orders.data_policy_version is 'Versión de la política de datos aceptada.';
comment on column public.orders.whatsapp_opt_in is 'Autorización de contacto por WhatsApp dada en el checkout.';
comment on column public.orders.discount_code_text is 'Copia del código de descuento usado; sobrevive al borrado del código.';

create or replace function public.orders_copiar_codigo_descuento()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.discount_code_id is not null and (tg_op = 'INSERT' or new.discount_code_id is distinct from old.discount_code_id) then
    select dc.code into new.discount_code_text from public.discount_codes dc where dc.id = new.discount_code_id;
  end if;
  return new;
end;
$$;

create trigger orders_copiar_codigo_descuento
  before insert or update of discount_code_id on public.orders
  for each row execute function public.orders_copiar_codigo_descuento();

revoke execute on function public.orders_copiar_codigo_descuento() from public, anon, authenticated;
