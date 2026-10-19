-- T1.13 · Reserva, liberación y confirmación atómicas de stock por pedido (§10.2, regla "el servidor manda").
-- Aditiva y reversible (drop function ...; alter table orders drop column stock_state).
--
-- orders.stock_state registra qué se hizo con el stock del pedido y hace idempotentes las tres funciones:
--   none -> reserved (reservar_stock) -> confirmed (confirmar_stock, al pagar) | released (liberar_stock, expira/abandona/cancela)
--   released/none -> confirmed (pago tardío: confirmar_stock reserva y confirma si hay stock; si no, ok=false)
-- Cada función bloquea el pedido y las filas de variant_countries (en orden de variant_id, sin interbloqueos), así que
-- dos reservas simultáneas del último producto se serializan: una gana y la otra recibe sin_stock.
-- Todas devuelven jsonb {ok, estado, repetido?, motivo?, faltantes?[]} y NO lanzan error por falta de stock: el
-- rechazo es completo (ninguna línea queda reservada). security invoker, search_path vacío, EXECUTE solo service_role.

alter table public.orders
  add column stock_state text not null default 'none' check (stock_state in ('none', 'reserved', 'confirmed', 'released'));
comment on column public.orders.stock_state is 'Estado del stock del pedido: none, reserved, confirmed o released (ver reservar_stock / liberar_stock / confirmar_stock).';

create or replace function public.reservar_stock(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o record;
  v_falt jsonb;
  v_int interval;
begin
  select id, country_code, status, stock_state into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.stock_state in ('reserved', 'confirmed') then
    return jsonb_build_object('ok', true, 'estado', o.stock_state, 'repetido', true);
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    return jsonb_build_object('ok', false, 'estado', o.stock_state, 'motivo', 'sin_items');
  end if;

  -- Bloqueo por fila, siempre en el mismo orden
  perform 1
    from public.variant_countries vc
    where vc.country_code = o.country_code
      and vc.variant_id in (select oi.variant_id from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is not null)
    order by vc.variant_id
    for update of vc;

  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', l.variant_id, 'sku', l.sku, 'solicitado', l.qty,
           'disponible', greatest(coalesce(vc.stock - vc.stock_reserved, 0), 0),
           'motivo', case when l.variant_id is null then 'variante_inexistente'
                          when vc.variant_id is null then 'sin_precio_en_pais'
                          when not vc.is_active then 'variante_inactiva'
                          else 'stock_insuficiente' end)), '[]'::jsonb)
    into v_falt
    from (select oi.variant_id, min(oi.sku) as sku, sum(oi.quantity)::int as qty
            from public.order_items oi where oi.order_id = p_order_id group by oi.variant_id) l
    left join public.variant_countries vc on vc.variant_id = l.variant_id and vc.country_code = o.country_code
    where l.variant_id is null or vc.variant_id is null or not vc.is_active or vc.stock - vc.stock_reserved < l.qty;

  if jsonb_array_length(v_falt) > 0 then
    return jsonb_build_object('ok', false, 'estado', o.stock_state, 'motivo', 'sin_stock', 'faltantes', v_falt);
  end if;

  update public.variant_countries vc
     set stock_reserved = vc.stock_reserved + l.qty
    from (select oi.variant_id, sum(oi.quantity)::int as qty
            from public.order_items oi where oi.order_id = p_order_id group by oi.variant_id) l
   where vc.variant_id = l.variant_id and vc.country_code = o.country_code;

  select case o.status
           when 'pendiente_pago' then make_interval(mins => cs.pending_payment_ttl_minutes)
           when 'esperando_abono' then make_interval(hours => cs.cod_link_ttl_hours)
           when 'pendiente_manual' then make_interval(hours => cs.manual_order_ttl_hours)
         end
    into v_int from public.country_settings cs where cs.country_code = o.country_code;

  update public.orders
     set stock_state = 'reserved',
         stock_reserved_until = case when v_int is null then stock_reserved_until else now() + v_int end
   where id = p_order_id;
  return jsonb_build_object('ok', true, 'estado', 'reserved');
end;
$$;

create or replace function public.liberar_stock(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare o record;
begin
  select id, country_code, stock_state into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.stock_state <> 'reserved' then
    -- none/released: nada que liberar; confirmed: el stock ya se descontó y no se devuelve aquí
    return jsonb_build_object('ok', true, 'estado', o.stock_state, 'repetido', true);
  end if;

  perform 1
    from public.variant_countries vc
    where vc.country_code = o.country_code
      and vc.variant_id in (select oi.variant_id from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is not null)
    order by vc.variant_id
    for update of vc;

  update public.variant_countries vc
     set stock_reserved = vc.stock_reserved - l.qty
    from (select oi.variant_id, sum(oi.quantity)::int as qty
            from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is not null group by oi.variant_id) l
   where vc.variant_id = l.variant_id and vc.country_code = o.country_code;

  update public.orders set stock_state = 'released', stock_reserved_until = null where id = p_order_id;
  return jsonb_build_object('ok', true, 'estado', 'released');
end;
$$;

create or replace function public.confirmar_stock(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o record;
  v_res jsonb;
begin
  select id, country_code, stock_state into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null, 'motivo', 'pedido_inexistente');
  end if;
  if o.stock_state = 'confirmed' then
    return jsonb_build_object('ok', true, 'estado', 'confirmed', 'repetido', true);
  end if;
  if o.stock_state <> 'reserved' then
    -- Pago tardío o sin reserva previa: reservar y confirmar si hay stock; si no, el worker marca requiere_reembolso
    v_res := public.reservar_stock(p_order_id);
    if not (v_res->>'ok')::boolean then
      return v_res;
    end if;
  end if;

  perform 1
    from public.variant_countries vc
    where vc.country_code = o.country_code
      and vc.variant_id in (select oi.variant_id from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is not null)
    order by vc.variant_id
    for update of vc;

  -- stock y stock_reserved bajan en la MISMA sentencia: nunca se viola stock_reserved <= stock
  update public.variant_countries vc
     set stock = vc.stock - l.qty, stock_reserved = vc.stock_reserved - l.qty
    from (select oi.variant_id, sum(oi.quantity)::int as qty
            from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is not null group by oi.variant_id) l
   where vc.variant_id = l.variant_id and vc.country_code = o.country_code;

  update public.orders set stock_state = 'confirmed', stock_reserved_until = null where id = p_order_id;
  return jsonb_build_object('ok', true, 'estado', 'confirmed');
end;
$$;

comment on function public.reservar_stock(uuid) is 'Reserva todo el stock del pedido o nada. Idempotente. Devuelve jsonb {ok, estado, motivo, faltantes}. Solo service_role.';
comment on function public.liberar_stock(uuid) is 'Libera la reserva del pedido (expira, abandona, cancela). Idempotente. Solo service_role.';
comment on function public.confirmar_stock(uuid) is 'Descuenta definitivamente el stock al pagar (stock y stock_reserved en la misma sentencia). Idempotente. Solo service_role.';

revoke execute on function public.reservar_stock(uuid), public.liberar_stock(uuid), public.confirmar_stock(uuid) from public, anon, authenticated;
grant execute on function public.reservar_stock(uuid), public.liberar_stock(uuid), public.confirmar_stock(uuid) to service_role;
