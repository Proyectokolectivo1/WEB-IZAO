-- B2 · `orders.number` y `warranty_claims.number` los asigna un trigger: con un default vacío la columna deja de ser
-- obligatoria en los tipos generados (Insert.number opcional). Los triggers asignan el número si llega null o ''.
-- Aditiva y reversible (drop default; restaurar las funciones anteriores).

alter table public.orders alter column number set default '';
alter table public.warranty_claims alter column number set default '';

create or replace function public.assign_order_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v text;
begin
  if new.number is null or new.number = '' then
    v := public.next_document_number('order', new.country_code)::text;
    if length(v) < 6 then v := lpad(v, 6, '0'); end if;
    new.number := 'IZ-' || new.country_code || '-' || v;
  end if;
  return new;
end;
$$;

create or replace function public.assign_warranty_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v text;
begin
  if new.number is null or new.number = '' then
    v := public.next_document_number('warranty', new.country_code)::text;
    if length(v) < 4 then v := lpad(v, 4, '0'); end if;
    new.number := 'GAR-' || new.country_code || '-' || v;
  end if;
  return new;
end;
$$;
