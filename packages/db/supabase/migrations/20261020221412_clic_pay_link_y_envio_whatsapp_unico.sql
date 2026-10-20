-- Abono de contra entrega (pedidos de izao-pagos, docs/estado/izao-pagos.md).
--
-- 1) pay_link_click(p_token text) -> jsonb. SOLO service_role (la ruta /pagar/{token} corre en el servidor).
--    En una sola sentencia suma un clic (fila bloqueada por el UPDATE: dos clics simultáneos cuentan dos)
--    y devuelve qué debe hacer la ruta:
--      {ok:true, estado:'vigente', order_id, order_number, clicks, expires_at, target_url}  -> 302 a target_url
--      {ok:true, estado:'pagado',  order_id, order_number, clicks, expires_at}              -> "Ya recibimos tu abono"
--      {ok:true, estado:'vencido', order_id, order_number, clicks, expires_at}              -> asesor
--      {ok:false, motivo:'no_existe'|'datos_invalidos'}
--    pagado  = existe un payments del pedido con purpose 'cod_deposit' y status 'approved'.
--    vencido = no pagado y (expires_at <= now() o el pedido ya no está en 'esperando_abono').
--    target_url solo sale cuando está vigente. Cuenta todos los clics, también los de links vencidos o pagados.
--
-- 2) whatsapp_messages: único (order_id, template_id, scheduled_for) para que un reintento del job no envíe
--    dos veces el mismo mensaje. Restricción simple (no índice parcial) para que PostgREST pueda usar
--    on_conflict=order_id,template_id,scheduled_for; con NULL en cualquiera de las tres no hay choque
--    (mensajes manuales o sin programación). Insertar duplicado -> 23505.
--    Nota: template_id es la versión de la plantilla; el worker debe fijar template_id y scheduled_for
--    antes del primer intento y reutilizarlos en los reintentos.

create or replace function public.pay_link_click(p_token text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link public.pay_links;
  v_status text;
  v_number text;
  v_pagado boolean;
  v_estado text;
  v_out jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{6,64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  update public.pay_links
     set clicks = least(clicks::bigint + 1, 2147483647)::integer
   where token = p_token
  returning * into v_link;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  select o.status, o.number into v_status, v_number
    from public.orders o
   where o.id = v_link.order_id;

  select exists (
    select 1 from public.payments p
     where p.order_id = v_link.order_id
       and p.purpose = 'cod_deposit'
       and p.status = 'approved'
  ) into v_pagado;

  v_estado := case
    when v_pagado then 'pagado'
    when v_link.expires_at <= now() or v_status is distinct from 'esperando_abono' then 'vencido'
    else 'vigente'
  end;

  v_out := jsonb_build_object(
    'ok', true,
    'estado', v_estado,
    'order_id', v_link.order_id,
    'order_number', v_number,
    'clicks', v_link.clicks,
    'expires_at', v_link.expires_at
  );
  if v_estado = 'vigente' then
    v_out := v_out || jsonb_build_object('target_url', v_link.target_url);
  end if;
  return v_out;
end;
$$;

revoke execute on function public.pay_link_click(text) from public, anon, authenticated;
grant execute on function public.pay_link_click(text) to service_role;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_envio_unico_key unique (order_id, template_id, scheduled_for);
