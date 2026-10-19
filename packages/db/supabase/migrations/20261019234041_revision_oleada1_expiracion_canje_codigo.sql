-- Revisión de la Oleada 1 (A2, M3, B4, B5). Aditiva: solo reemplaza funciones y recrea un índice parcial.
--
-- A2  pedidos_por_vencer incluye pago_rechazado -> expirado (§16), para que un pago rechazado libere stock y canje.
--     El índice parcial orders_stock_reserved_until_idx se recrea con los cuatro estados.
-- M3  confirmar_canje ya no revalida: se llama cuando el cliente pagó, así que confirma sin mirar vigencia ni cupo.
--     Si con eso se supera usage_limit_total o usage_limit_per_customer, confirma igual y devuelve
--     {ok:true, estado:'confirmed', advertencia:'limite_superado'} para que el worker alerte al admin.
-- B4  discount_code_text lo fija solo el servidor: sin discount_code_id no se acepta un valor escrito a mano.
-- B5  vigencia alineada con el motor de precios: el código está vencido cuando now() >= ends_at.

-- A2 ---------------------------------------------------------------------------------------------------------------
drop index public.orders_stock_reserved_until_idx;
create index orders_stock_reserved_until_idx on public.orders (stock_reserved_until)
  where status in ('pendiente_pago', 'pago_rechazado', 'esperando_abono', 'pendiente_manual');

create or replace function public.pedidos_por_vencer(p_ahora timestamptz default now(), p_limite integer default 500)
returns table (
  order_id uuid,
  number text,
  country_code text,
  payment_method text,
  estado_actual text,
  nuevo_estado text,
  stock_reserved_until timestamptz,
  stock_state text,
  tiene_codigo boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.number, o.country_code, o.payment_method, o.status,
         case o.status
           when 'pendiente_pago' then 'expirado'
           when 'pago_rechazado' then 'expirado'
           when 'esperando_abono' then 'abandonado'
           when 'pendiente_manual' then 'expirado'
         end,
         o.stock_reserved_until, o.stock_state, o.discount_code_id is not null
    from public.orders o
   where o.stock_reserved_until < p_ahora
     and o.status in ('pendiente_pago', 'pago_rechazado', 'esperando_abono', 'pendiente_manual')
   order by o.stock_reserved_until
   limit greatest(coalesce(p_limite, 500), 1);
$$;
comment on function public.pedidos_por_vencer(timestamptz, integer) is
  'Pedidos con stock_reserved_until vencido en pendiente_pago, pago_rechazado, esperando_abono o pendiente_manual y el estado al que deben pasar. Solo lectura. Solo service_role.';

-- B5: reservar_canje con vigencia now >= ends_at ------------------------------------------------------------------------
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
  if (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at <= now()) then
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

-- M3 ---------------------------------------------------------------------------------------------------------------
create or replace function public.confirmar_canje(p_order_id uuid)
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
  v_exceso boolean := false;
begin
  select id, discount_code_id, discount_amount, document_number, contact_phone_e164, contact_email
    into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.discount_code_id is null then
    return jsonb_build_object('ok', true, 'estado', 'sin_codigo');
  end if;

  select * into c from public.discount_codes where id = o.discount_code_id for update;
  select * into r from public.discount_redemptions where discount_code_id = o.discount_code_id and order_id = p_order_id;
  if found and r.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'estado', 'confirmed', 'repetido', true);
  end if;

  if found and r.status = 'reserved' then
    update public.discount_redemptions set status = 'confirmed' where id = r.id;
    return jsonb_build_object('ok', true, 'estado', 'confirmed');
  end if;

  -- Sin canje previo o liberado (pago tardío): el cliente ya pagó con el descuento, se confirma sin revalidar vigencia
  -- ni cupo; si se supera algún límite se avisa para que el worker alerte al administrador.
  v_keys := public.claves_cliente(o.document_number, o.contact_phone_e164, o.contact_email);
  v_exceso := (c.usage_limit_total is not null and c.usage_count >= c.usage_limit_total)
           or (c.usage_limit_per_customer is not null and (
                select count(*) from public.discount_redemptions x
                 where x.discount_code_id = c.id and x.status in ('reserved', 'confirmed')
                   and x.order_id <> p_order_id and x.customer_keys && v_keys) >= c.usage_limit_per_customer);

  insert into public.discount_redemptions (discount_code_id, order_id, customer_key, customer_keys, amount, status)
  values (c.id, p_order_id, coalesce(v_keys[1], ''), v_keys, o.discount_amount, 'confirmed')
  on conflict (discount_code_id, order_id) do update
    set status = 'confirmed', amount = excluded.amount, customer_key = excluded.customer_key, customer_keys = excluded.customer_keys;
  update public.discount_codes set usage_count = usage_count + 1 where id = c.id;

  if v_exceso then
    return jsonb_build_object('ok', true, 'estado', 'confirmed', 'advertencia', 'limite_superado');
  end if;
  return jsonb_build_object('ok', true, 'estado', 'confirmed');
end;
$$;
comment on function public.confirmar_canje(uuid) is 'Confirma el uso al pagar. En pago tardío confirma sin revalidar y avisa con advertencia limite_superado si se superó un límite. Idempotente. Solo service_role.';

-- B4 ---------------------------------------------------------------------------------------------------------------
-- El texto lo decide el servidor: al insertar se copia del código (o queda nulo); al actualizar solo cambia si cambia
-- discount_code_id. Si el FK pasa a nulo (se borró el código) se conserva el texto anterior.
create or replace function public.orders_copiar_codigo_descuento()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.discount_code_text := null;
    if new.discount_code_id is not null then
      select dc.code into new.discount_code_text from public.discount_codes dc where dc.id = new.discount_code_id;
    end if;
  elsif new.discount_code_id is not null and new.discount_code_id is distinct from old.discount_code_id then
    select dc.code into new.discount_code_text from public.discount_codes dc where dc.id = new.discount_code_id;
  else
    new.discount_code_text := old.discount_code_text;
  end if;
  return new;
end;
$$;

drop trigger orders_copiar_codigo_descuento on public.orders;
create trigger orders_copiar_codigo_descuento
  before insert or update of discount_code_id, discount_code_text on public.orders
  for each row execute function public.orders_copiar_codigo_descuento();
