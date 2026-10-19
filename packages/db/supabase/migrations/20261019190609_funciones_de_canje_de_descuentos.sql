-- T1.14 · Canje de códigos de descuento (§17.1): reservar_canje / confirmar_canje / liberar_canje.
-- Aditiva y reversible (drop function ...; drop column customer_keys).
--
-- El uso queda `reserved` al crear el pedido (cuenta en usage_count), pasa a `confirmed` al pagar (usage_count no cambia)
-- y vuelve a `released` si el pedido expira o se abandona (usage_count baja). Cada función bloquea el pedido y luego la
-- fila del código, de modo que los canjes simultáneos del mismo código se serializan y los límites son exactos.
-- Límite por cliente: se identifica por documento, celular y correo; customer_keys guarda los tres hashes (sha256 de los
-- valores normalizados) y customer_key conserva el principal. Todas devuelven jsonb {ok, estado, repetido?, motivo?}.
-- security invoker, search_path vacío, EXECUTE solo service_role.

alter table public.discount_redemptions
  add column customer_keys text[] not null default '{}';
comment on column public.discount_redemptions.customer_keys is 'Hashes sha256 (documento, celular, correo normalizados) del cliente que canjeó; el límite por cliente se evalúa por intersección.';
create index discount_redemptions_customer_keys_idx on public.discount_redemptions using gin (customer_keys);

create or replace function public.claves_cliente(p_documento text, p_celular text, p_correo text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k), '{}') from (
    select encode(extensions.digest(convert_to('doc:' || regexp_replace(upper(p_documento), '[^A-Z0-9]', '', 'g'), 'UTF8'), 'sha256'), 'hex') as k
      where coalesce(regexp_replace(upper(p_documento), '[^A-Z0-9]', '', 'g'), '') <> ''
    union all
    select encode(extensions.digest(convert_to('tel:' || regexp_replace(p_celular, '[^0-9]', '', 'g'), 'UTF8'), 'sha256'), 'hex')
      where coalesce(regexp_replace(p_celular, '[^0-9]', '', 'g'), '') <> ''
    union all
    select encode(extensions.digest(convert_to('mail:' || lower(btrim(p_correo)), 'UTF8'), 'sha256'), 'hex')
      where coalesce(btrim(p_correo), '') <> ''
  ) s;
$$;

create or replace function public.reservar_canje(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o record;
  c record;
  r record;
  v_keys text[];
begin
  select id, country_code, discount_code_id, discount_amount, document_number, contact_phone_e164, contact_email
    into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.discount_code_id is null then
    return jsonb_build_object('ok', true, 'estado', 'sin_codigo');
  end if;

  select * into c from public.discount_codes where id = o.discount_code_id for update;
  select * into r from public.discount_redemptions where discount_code_id = o.discount_code_id and order_id = p_order_id;
  if found and r.status in ('reserved', 'confirmed') then
    return jsonb_build_object('ok', true, 'estado', r.status, 'repetido', true);
  end if;

  if not c.is_active then
    return jsonb_build_object('ok', false, 'estado', coalesce(r.status, 'none'), 'motivo', 'codigo_inactivo');
  end if;
  if c.country_code <> o.country_code then
    return jsonb_build_object('ok', false, 'estado', coalesce(r.status, 'none'), 'motivo', 'codigo_de_otro_pais');
  end if;
  if (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at < now()) then
    return jsonb_build_object('ok', false, 'estado', coalesce(r.status, 'none'), 'motivo', 'codigo_fuera_de_vigencia');
  end if;
  if c.usage_limit_total is not null and c.usage_count >= c.usage_limit_total then
    return jsonb_build_object('ok', false, 'estado', coalesce(r.status, 'none'), 'motivo', 'limite_total');
  end if;

  v_keys := public.claves_cliente(o.document_number, o.contact_phone_e164, o.contact_email);
  if c.usage_limit_per_customer is not null and (
       select count(*) from public.discount_redemptions x
        where x.discount_code_id = c.id and x.status in ('reserved', 'confirmed')
          and x.order_id <> p_order_id and x.customer_keys && v_keys) >= c.usage_limit_per_customer then
    return jsonb_build_object('ok', false, 'estado', coalesce(r.status, 'none'), 'motivo', 'limite_por_cliente');
  end if;

  insert into public.discount_redemptions (discount_code_id, order_id, customer_key, customer_keys, amount, status)
  values (c.id, p_order_id, coalesce(v_keys[1], ''), v_keys, o.discount_amount, 'reserved')
  on conflict (discount_code_id, order_id) do update
    set status = 'reserved', amount = excluded.amount, customer_key = excluded.customer_key, customer_keys = excluded.customer_keys;
  update public.discount_codes set usage_count = usage_count + 1 where id = c.id;
  return jsonb_build_object('ok', true, 'estado', 'reserved');
end;
$$;

create or replace function public.confirmar_canje(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o record;
  r record;
  v_res jsonb;
begin
  select id, discount_code_id into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.discount_code_id is null then
    return jsonb_build_object('ok', true, 'estado', 'sin_codigo');
  end if;

  select * into r from public.discount_redemptions where discount_code_id = o.discount_code_id and order_id = p_order_id;
  if found and r.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'estado', 'confirmed', 'repetido', true);
  end if;
  if not found or r.status = 'released' then
    -- Pago tardío o sin reserva previa: reservar (respeta los límites) y confirmar
    v_res := public.reservar_canje(p_order_id);
    if not (v_res->>'ok')::boolean then
      return v_res;
    end if;
  end if;
  update public.discount_redemptions set status = 'confirmed'
   where discount_code_id = o.discount_code_id and order_id = p_order_id;
  return jsonb_build_object('ok', true, 'estado', 'confirmed');
end;
$$;

create or replace function public.liberar_canje(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o record;
  r record;
begin
  select id, discount_code_id into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.discount_code_id is null then
    return jsonb_build_object('ok', true, 'estado', 'sin_codigo');
  end if;

  perform 1 from public.discount_codes where id = o.discount_code_id for update;
  select * into r from public.discount_redemptions where discount_code_id = o.discount_code_id and order_id = p_order_id;
  if not found or r.status <> 'reserved' then
    -- sin canje o ya liberado: nada que hacer; confirmado: el uso ya es definitivo
    return jsonb_build_object('ok', true, 'estado', coalesce(r.status, 'none'), 'repetido', true);
  end if;
  update public.discount_redemptions set status = 'released' where id = r.id;
  update public.discount_codes set usage_count = usage_count - 1 where id = o.discount_code_id;
  return jsonb_build_object('ok', true, 'estado', 'released');
end;
$$;

comment on function public.reservar_canje(uuid) is 'Reserva el uso del código del pedido respetando usage_limit_total y usage_limit_per_customer (documento, celular, correo). Idempotente. Solo service_role.';
comment on function public.confirmar_canje(uuid) is 'Confirma el uso al pagar (reserva antes si hace falta). Idempotente. Solo service_role.';
comment on function public.liberar_canje(uuid) is 'Libera el uso reservado cuando el pedido expira o se abandona. Idempotente. Solo service_role.';

revoke execute on function public.claves_cliente(text, text, text), public.reservar_canje(uuid), public.confirmar_canje(uuid), public.liberar_canje(uuid)
  from public, anon, authenticated;
grant execute on function public.claves_cliente(text, text, text), public.reservar_canje(uuid), public.confirmar_canje(uuid), public.liberar_canje(uuid)
  to service_role;
