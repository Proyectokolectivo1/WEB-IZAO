-- T1.15 · Pedidos con la reserva vencida, para que el worker los pase a expirado/abandonado y libere stock y canje.
-- Solo lectura (stable). Usa el índice parcial orders_stock_reserved_until_idx. Aditiva y reversible (drop function).
--   pendiente_pago  -> expirado
--   esperando_abono -> abandonado
--   pendiente_manual -> expirado (D-002)
-- Por cada fila el worker: cambia el estado (y escribe order_events), llama liberar_stock(order_id) y liberar_canje(order_id).

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
           when 'esperando_abono' then 'abandonado'
           when 'pendiente_manual' then 'expirado'
         end,
         o.stock_reserved_until, o.stock_state, o.discount_code_id is not null
    from public.orders o
   where o.stock_reserved_until < p_ahora
     and o.status in ('pendiente_pago', 'esperando_abono', 'pendiente_manual')
   order by o.stock_reserved_until
   limit greatest(coalesce(p_limite, 500), 1);
$$;
comment on function public.pedidos_por_vencer(timestamptz, integer) is
  'Pedidos con stock_reserved_until vencido en pendiente_pago, esperando_abono o pendiente_manual y el estado al que deben pasar. Solo lectura. Solo service_role.';

revoke execute on function public.pedidos_por_vencer(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.pedidos_por_vencer(timestamptz, integer) to service_role;
