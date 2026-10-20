-- Pedido (4) de izao-pagos (docs/estado/izao-pagos.md). Aditiva; reversible con
--   drop function public.aplicar_transicion_pedido(jsonb); drop index public.payments_provider_reference_key;
--
-- (a) payments_provider_reference_key: único parcial (provider, provider_reference) where provider_reference is not null.
--     La referencia del pago (p. ej. IZ-CO-000123-P2 de Wompi) identifica un solo intento por proveedor.
-- (b) aplicar_transicion_pedido(p jsonb): cambio de estado condicional + evento en UNA transacción.
--     p = {order_id, from_status, to_status, actor, payload?, fechas?: {paid_at?, abandoned_at?, sent_to_carrier_at?,
--          delivered_at?, cancelled_at?}}
--     La legalidad de la transición la decide @izao/core/order-state (transicionar) antes de llamar; la base garantiza
--     atomicidad, la condición sobre el estado leído y las restricciones (estados, actor).
--     Devuelve jsonb:
--       {ok:true, order_id, from_status, to_status, event_id}
--       {ok:false, motivo:'estado_cambiado', status_actual}  (otro proceso ya lo movió; nada escrito)
--       {ok:false, motivo:'pedido_inexistente'}
--       {ok:false, motivo:'datos_invalidos', detalle}        (forma, mismo estado, fecha mal formada, CHECK de estado/actor)
--     security invoker, search_path vacío, EXECUTE solo service_role.

create unique index payments_provider_reference_key on public.payments (provider, provider_reference)
  where provider_reference is not null;

create or replace function public.aplicar_transicion_pedido(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_de text;
  v_a text;
  v_actor text;
  v_payload jsonb;
  v_f jsonb;
  v_ev uuid;
  v_actual text;
  v_con text;
  v_col text;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'forma');
  end if;
  v_de := nullif(btrim(p->>'from_status'), '');
  v_a := nullif(btrim(p->>'to_status'), '');
  v_actor := nullif(btrim(p->>'actor'), '');
  v_payload := coalesce(p->'payload', '{}'::jsonb);
  v_f := coalesce(p->'fechas', '{}'::jsonb);
  if v_de is null or v_a is null or v_actor is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'from_status/to_status/actor');
  end if;
  if v_de = v_a then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'mismo_estado');
  end if;
  if jsonb_typeof(v_payload) is distinct from 'object' or jsonb_typeof(v_f) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'payload/fechas');
  end if;
  if exists (select 1 from jsonb_object_keys(v_f) k
              where k not in ('paid_at', 'abandoned_at', 'sent_to_carrier_at', 'delivered_at', 'cancelled_at')) then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'fechas');
  end if;

  begin
    v_id := (p->>'order_id')::uuid;
    if v_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'order_id');
    end if;

    update public.orders o
       set status = v_a,
           paid_at = case when v_f ? 'paid_at' then (v_f->>'paid_at')::timestamptz else o.paid_at end,
           abandoned_at = case when v_f ? 'abandoned_at' then (v_f->>'abandoned_at')::timestamptz else o.abandoned_at end,
           sent_to_carrier_at = case when v_f ? 'sent_to_carrier_at' then (v_f->>'sent_to_carrier_at')::timestamptz else o.sent_to_carrier_at end,
           delivered_at = case when v_f ? 'delivered_at' then (v_f->>'delivered_at')::timestamptz else o.delivered_at end,
           cancelled_at = case when v_f ? 'cancelled_at' then (v_f->>'cancelled_at')::timestamptz else o.cancelled_at end
     where o.id = v_id and o.status = v_de;

    if not found then
      select o.status into v_actual from public.orders o where o.id = v_id;
      if not found then
        return jsonb_build_object('ok', false, 'motivo', 'pedido_inexistente');
      end if;
      return jsonb_build_object('ok', false, 'motivo', 'estado_cambiado', 'status_actual', v_actual);
    end if;

    insert into public.order_events (order_id, type, from_status, to_status, actor, payload)
    values (v_id, 'status_changed', v_de, v_a, v_actor, v_payload)
    returning id into v_ev;
  exception
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
         or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
      get stacked diagnostics v_con = constraint_name, v_col = column_name;
      return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos',
                                'detalle', coalesce(nullif(v_con, ''), nullif(v_col, ''), sqlstate));
  end;

  return jsonb_build_object('ok', true, 'order_id', v_id, 'from_status', v_de, 'to_status', v_a, 'event_id', v_ev);
end;
$$;
comment on function public.aplicar_transicion_pedido(jsonb) is
  'Cambia orders.status de from_status a to_status solo si sigue en from_status y registra el evento status_changed, en una transacción. La legalidad la valida @izao/core/order-state. Solo service_role.';

revoke execute on function public.aplicar_transicion_pedido(jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_transicion_pedido(jsonb) to service_role;
