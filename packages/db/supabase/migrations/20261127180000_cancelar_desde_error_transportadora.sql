-- D-061 · cancelar_pedido acepta `error_transportadora` (pedido pagado que MasterShop nunca aceptó).
--
-- Aditiva: misma firma, mismo cuerpo que 20261025191446 (definición vigente leída en producción el 2026-11-27) salvo:
--   1. `error_transportadora` entra en la lista de from_status aceptados.
--   2. Solo desde `error_transportadora`: el motivo es obligatorio (`datos_invalidos`/`motivo` si falta).
--   3. Solo desde `error_transportadora`, si hubo dinero cobrado (pagos `approved` o `paid_at`): evento `alerta`
--      `reembolso_manual_pendiente` con los pagos aprobados (proveedor, propósito, monto, moneda, referencia,
--      transacción), en la misma transacción, y la respuesta suma `reembolso_pendiente` y `pagos_a_reembolsar`.
-- Stock (liberar la reserva / devolver lo confirmado / retener si hubo recolección), eventos, search_path vacío y
-- grants (solo service_role) quedan iguales. `error_transportadora` viene siempre de `pagado`/`abono_pagado`, así que
-- su stock está `confirmed` y se devuelve.
-- Excepción de zona autorizada por el líder (izao-pagos escribe esta migración; la aplica el líder).

create or replace function public.cancelar_pedido(p jsonb)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_de text;
  v_motivo text;
  v_cuando timestamptz;
  v_t jsonb;
  v_s jsonb;
  v_pais text;
  v_estado text;
  v_recolectado integer;
  v_dev jsonb := '[]'::jsonb;
  v_nodev jsonb := '[]'::jsonb;
  v_unidades integer := 0;
  v_retenido text;
  v_pagos jsonb := '[]'::jsonb;
  v_pagado_en timestamptz;
  v_reembolso jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'forma');
  end if;
  begin
    v_id := (p->>'order_id')::uuid;
    v_cuando := coalesce((p->>'cancelled_at')::timestamptz, now());
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'order_id/cancelled_at');
  end;
  v_de := nullif(btrim(p->>'from_status'), '');
  v_motivo := nullif(btrim(p->>'motivo'), '');
  if v_id is null or v_de is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'order_id/from_status');
  end if;
  if v_de not in ('pendiente_manual', 'enviado_transportadora', 'en_preparacion', 'requiere_reembolso', 'error_transportadora') then
    return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida', 'from_status', v_de);
  end if;
  -- D-061: cancelar un pedido pagado que nunca llegó a MasterShop es una decisión manual y debe quedar explicada.
  if v_de = 'error_transportadora' and v_motivo is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'motivo');
  end if;

  v_t := public.aplicar_transicion_pedido(jsonb_build_object(
    'order_id', v_id,
    'from_status', v_de,
    'to_status', 'cancelado',
    'actor', p->>'actor',
    'payload', case when v_motivo is null then '{}'::jsonb else jsonb_build_object('motivo', v_motivo) end,
    'fechas', jsonb_build_object('cancelled_at', v_cuando)));
  if not coalesce((v_t->>'ok')::boolean, false) then
    return v_t;
  end if;

  v_s := public.liberar_stock(v_id);
  if not coalesce((v_s->>'ok')::boolean, false) then
    raise exception 'cancelar_pedido: liberar_stock falló para %', v_id;
  end if;
  v_estado := v_s->>'estado';

  if v_estado = 'confirmed' then
    select o.country_code into v_pais from public.orders o where o.id = v_id;
    select max(s.provider_status_id) into v_recolectado
      from public.shipments s
     where s.order_id = v_id and s.provider_status_id in (5, 6, 8, 10, 11);

    if v_recolectado is not null then
      v_retenido := 'envio_recolectado';
      insert into public.order_events (order_id, type, payload, actor)
      values (v_id, 'stock_retenido',
              jsonb_build_object('motivo', v_retenido, 'provider_status_id', v_recolectado), p->>'actor');
    else
      perform 1
        from public.variant_countries vc
       where vc.country_code = v_pais
         and vc.variant_id in (select oi.variant_id from public.order_items oi where oi.order_id = v_id and oi.variant_id is not null)
       order by vc.variant_id
         for update of vc;

      with l as (
        select oi.variant_id, min(oi.sku) as sku, sum(oi.quantity)::integer as qty
          from public.order_items oi
         where oi.order_id = v_id and oi.variant_id is not null
         group by oi.variant_id
      ), u as (
        update public.variant_countries vc
           set stock = vc.stock + l.qty
          from l
         where vc.variant_id = l.variant_id and vc.country_code = v_pais
        returning l.variant_id, l.sku, l.qty
      )
      select coalesce(jsonb_agg(jsonb_build_object('variant_id', u.variant_id, 'sku', u.sku, 'cantidad', u.qty)
                                order by u.variant_id), '[]'::jsonb),
             coalesce(sum(u.qty), 0)::integer
        into v_dev, v_unidades
        from u;

      select coalesce(jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'sku', l.sku, 'cantidad', l.qty,
                                                   'motivo', case when l.variant_id is null then 'variante_inexistente'
                                                                  else 'sin_fila_en_pais' end)
                                order by l.sku), '[]'::jsonb)
        into v_nodev
        from (select oi.variant_id, min(oi.sku) as sku, sum(oi.quantity)::integer as qty
                from public.order_items oi where oi.order_id = v_id group by oi.variant_id) l
        left join public.variant_countries vc on vc.variant_id = l.variant_id and vc.country_code = v_pais
       where l.variant_id is null or vc.variant_id is null;

      update public.orders set stock_state = 'released', stock_reserved_until = null where id = v_id;
      v_estado := 'released';

      insert into public.order_events (order_id, type, payload, actor)
      values (v_id, 'stock_devuelto', jsonb_build_object('lineas', v_dev, 'no_devueltas', v_nodev), p->>'actor');
    end if;
  end if;

  -- D-061: el dinero cobrado de un pedido que nunca salió queda marcado para reembolso manual (Wompi, Addi o el
  -- medio del pago manual). El reembolso no se hace aquí: lo hace el admin en el proveedor.
  if v_de = 'error_transportadora' then
    select o.paid_at into v_pagado_en from public.orders o where o.id = v_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'payment_id', py.id,
             'provider', py.provider,
             'purpose', py.purpose,
             'amount', py.amount,
             'currency_code', py.currency_code,
             'provider_reference', py.provider_reference,
             'provider_transaction_id', py.provider_transaction_id) order by py.created_at, py.id), '[]'::jsonb)
      into v_pagos
      from public.payments py
     where py.order_id = v_id and py.status = 'approved';

    if jsonb_array_length(v_pagos) > 0 or v_pagado_en is not null then
      insert into public.order_events (order_id, type, payload, actor)
      values (v_id, 'alerta',
              jsonb_build_object('motivo', 'reembolso_manual_pendiente',
                                 'desde', v_de,
                                 'motivo_cancelacion', v_motivo,
                                 'pagos', v_pagos,
                                 'pago_fuera_de_pasarela', jsonb_array_length(v_pagos) = 0),
              p->>'actor');
      v_reembolso := jsonb_build_object('reembolso_pendiente', true, 'pagos_a_reembolsar', v_pagos);
    else
      v_reembolso := jsonb_build_object('reembolso_pendiente', false, 'pagos_a_reembolsar', '[]'::jsonb);
    end if;
  end if;

  return v_t || jsonb_build_object(
    'stock_estado', v_estado,
    'stock_liberado', (v_s->>'estado') = 'released' and not coalesce((v_s->>'repetido')::boolean, false),
    'stock_devuelto', v_unidades > 0,
    'unidades_devueltas', v_unidades,
    'stock_retenido', v_retenido) || v_reembolso;
end;
$function$;

revoke all on function public.cancelar_pedido(jsonb) from public, anon, authenticated;
grant execute on function public.cancelar_pedido(jsonb) to service_role;
