-- T3.1b · Creación transaccional del pedido del checkout (§10.2, §11, §17.1). Decisión 1 de izao-pagos.
-- Aditiva y reversible (drop function public.crear_pedido_checkout(jsonb), public.pedido_checkout_resumen(uuid),
-- public.pedido_checkout_existente(text, text)).
--
-- crear_pedido_checkout(p jsonb) hace en UNA transacción: pedido -> líneas -> reservar_stock -> reservar_canje ->
-- evento 'created'. Todo o nada: cualquier rechazo deshace lo escrito (subtransacción) y no deja pedidos huérfanos.
-- Idempotente por orders.checkout_idempotency_key (dos llamadas simultáneas con la misma clave: la segunda espera al
-- índice único y devuelve el pedido de la primera).
--
-- p = {order: {country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, contact_email,
--              document_type, document_number, shipping_region_id, shipping_city_id, shipping_region_name,
--              shipping_city_name, shipping_district, shipping_address1, shipping_address2, shipping_zip, shipping_notes,
--              payment_method, subtotal, discount_code_id, discount_amount, financing_surcharge_pct,
--              financing_surcharge_amount, total_customer, cod_deposit_amount, cod_collect_amount, product_cost_total,
--              gateway_fee_estimated, customer_id, influencer_id, utm, click_ids, checkout_idempotency_key,
--              terms_accepted_at, data_policy_version, whatsapp_opt_in},
--      items: [{product_id, variant_id, sku, name_snapshot, variant_label, quantity, unit_price, unit_compare_at,
--               unit_cost, line_discount, weight_kg, mastershop_product_id, mastershop_variant_id}]}
-- Lista blanca: id, number, public_token, status, stock_state, alerts y fechas de ciclo de vida NO se aceptan.
-- El estado inicial lo fija la base por método: wompi/addi/sistecredito -> pendiente_pago; cod -> esperando_abono;
-- manual -> pendiente_manual. Montos bigint como número o texto.
--
-- Devuelve jsonb {ok, estado, repetido?, motivo?, detalle?, faltantes?, order?}:
--   ok=true  estado 'creado' (repetido=false) | 'existente' (repetido=true), order = resumen (montos en texto).
--   ok=false estado 'existente': motivo idempotencia_conflicto (la clave es de otro país) | en_proceso (pedido previo
--            sin evento 'created', del flujo anterior).
--   ok=false estado 'rechazado' (nada queda escrito): motivo sin_stock (+ faltantes de reservar_stock) | sin_items |
--            codigo_inactivo | codigo_de_otro_pais | codigo_fuera_de_vigencia | limite_total | limite_por_cliente |
--            totales_inconsistentes | datos_invalidos (+ detalle: restricción, columna o SQLSTATE; nunca valores).
-- Errores inesperados se propagan (la transacción completa se deshace). security invoker, search_path vacío,
-- EXECUTE solo service_role.

create or replace function public.pedido_checkout_resumen(p_order_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'id', o.id, 'number', o.number, 'public_token', o.public_token, 'status', o.status,
           'country_code', o.country_code, 'currency_code', o.currency_code, 'payment_method', o.payment_method,
           'subtotal', o.subtotal::text, 'discount_amount', o.discount_amount::text,
           'financing_surcharge_amount', o.financing_surcharge_amount::text, 'total_customer', o.total_customer::text,
           'cod_deposit_amount', o.cod_deposit_amount::text, 'cod_collect_amount', o.cod_collect_amount::text,
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'variant_id', i.variant_id, 'name_snapshot', i.name_snapshot, 'variant_label', i.variant_label,
                      'quantity', i.quantity, 'unit_price', i.unit_price::text, 'line_discount', i.line_discount::text)
                    order by i.name_snapshot, i.sku, i.id)
               from public.order_items i where i.order_id = o.id), '[]'::jsonb))
    from public.orders o
   where o.id = p_order_id;
$$;
comment on function public.pedido_checkout_resumen(uuid) is
  'Resumen del pedido del checkout (montos en texto, líneas por nombre y sku). Uso interno de crear_pedido_checkout.';

create or replace function public.pedido_checkout_existente(p_clave text, p_pais text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare o record;
begin
  select id, country_code into o from public.orders where checkout_idempotency_key = p_clave;
  if not found then
    return null;
  end if;
  if o.country_code is distinct from p_pais then
    return jsonb_build_object('ok', false, 'estado', 'existente', 'motivo', 'idempotencia_conflicto');
  end if;
  if not exists (select 1 from public.order_events e where e.order_id = o.id and e.type = 'created') then
    return jsonb_build_object('ok', false, 'estado', 'existente', 'motivo', 'en_proceso');
  end if;
  return jsonb_build_object('ok', true, 'estado', 'existente', 'repetido', true, 'order', public.pedido_checkout_resumen(o.id));
end;
$$;
comment on function public.pedido_checkout_existente(text, text) is
  'Pedido ya creado con esa clave de idempotencia (o null). Uso interno de crear_pedido_checkout.';

create or replace function public.crear_pedido_checkout(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_o public.orders;
  v_clave text;
  v_estado text;
  v_id uuid;
  v_codigo text;
  v_res jsonb;
  v_rech jsonb;
  v_sub bigint;
  v_desc bigint;
  v_con text;
  v_col text;
begin
  if p is null or jsonb_typeof(p->'order') is distinct from 'object' or jsonb_typeof(p->'items') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'datos_invalidos', 'detalle', 'forma');
  end if;
  v_clave := nullif(btrim(p->'order'->>'checkout_idempotency_key'), '');
  if v_clave is null then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'datos_invalidos', 'detalle', 'checkout_idempotency_key');
  end if;
  if jsonb_array_length(p->'items') = 0 then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'sin_items');
  end if;

  -- 1. Idempotencia (doble clic, reintento)
  v_res := public.pedido_checkout_existente(v_clave, p->'order'->>'country_code');
  if v_res is not null then
    return v_res;
  end if;

  -- 2. Todo lo que escribe va en una subtransacción: un rechazo la deshace completa
  begin
    v_o := jsonb_populate_record(null::public.orders, p->'order');
    v_estado := case v_o.payment_method
                  when 'wompi' then 'pendiente_pago'
                  when 'addi' then 'pendiente_pago'
                  when 'sistecredito' then 'pendiente_pago'
                  when 'cod' then 'esperando_abono'
                  when 'manual' then 'pendiente_manual'
                end;
    if v_estado is null then
      v_rech := jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'datos_invalidos', 'detalle', 'payment_method');
      raise exception 'rechazo' using errcode = 'IZ001';
    end if;

    insert into public.orders (
      country_code, currency_code, customer_id, contact_first_name, contact_last_name, contact_phone_e164, contact_email,
      document_type, document_number, shipping_region_id, shipping_city_id, shipping_region_name, shipping_city_name,
      shipping_district, shipping_address1, shipping_address2, shipping_zip, shipping_notes,
      payment_method, status, subtotal, discount_code_id, discount_amount, financing_surcharge_pct, financing_surcharge_amount,
      total_customer, cod_deposit_amount, cod_collect_amount, gateway_fee_estimated, product_cost_total, influencer_id,
      utm, click_ids, checkout_idempotency_key, terms_accepted_at, data_policy_version, whatsapp_opt_in)
    values (
      v_o.country_code, v_o.currency_code, v_o.customer_id, v_o.contact_first_name, v_o.contact_last_name,
      v_o.contact_phone_e164, v_o.contact_email, v_o.document_type, v_o.document_number, v_o.shipping_region_id,
      v_o.shipping_city_id, v_o.shipping_region_name, v_o.shipping_city_name, v_o.shipping_district, v_o.shipping_address1,
      v_o.shipping_address2, v_o.shipping_zip, v_o.shipping_notes,
      v_o.payment_method, v_estado, v_o.subtotal, v_o.discount_code_id, coalesce(v_o.discount_amount, 0),
      coalesce(v_o.financing_surcharge_pct, 0), coalesce(v_o.financing_surcharge_amount, 0), v_o.total_customer,
      coalesce(v_o.cod_deposit_amount, 0), coalesce(v_o.cod_collect_amount, 0), coalesce(v_o.gateway_fee_estimated, 0),
      coalesce(v_o.product_cost_total, 0), v_o.influencer_id, coalesce(v_o.utm, '{}'::jsonb),
      coalesce(v_o.click_ids, '{}'::jsonb), v_clave, v_o.terms_accepted_at, v_o.data_policy_version,
      coalesce(v_o.whatsapp_opt_in, false))
    returning id, discount_code_text into v_id, v_codigo;

    insert into public.order_items (
      order_id, product_id, variant_id, sku, name_snapshot, variant_label, quantity, unit_price, unit_compare_at,
      unit_cost, line_discount, weight_kg, mastershop_product_id, mastershop_variant_id)
    select v_id, x.product_id, x.variant_id, x.sku, x.name_snapshot, x.variant_label, x.quantity, x.unit_price,
           x.unit_compare_at, x.unit_cost, coalesce(x.line_discount, 0), x.weight_kg, x.mastershop_product_id,
           x.mastershop_variant_id
      from jsonb_populate_recordset(null::public.order_items, p->'items') x;

    -- Defensa: subtotal = Σ precio × cantidad y descuento = Σ descuento de línea (§11.2)
    select sum(i.unit_price * i.quantity), sum(i.line_discount) into v_sub, v_desc
      from public.order_items i where i.order_id = v_id;
    if v_sub is distinct from v_o.subtotal or v_desc is distinct from coalesce(v_o.discount_amount, 0) then
      v_rech := jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'totales_inconsistentes');
      raise exception 'rechazo' using errcode = 'IZ001';
    end if;

    v_res := public.reservar_stock(v_id);
    if not coalesce((v_res->>'ok')::boolean, false) then
      v_rech := jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', coalesce(v_res->>'motivo', 'sin_stock'),
                                   'faltantes', coalesce(v_res->'faltantes', '[]'::jsonb));
      raise exception 'rechazo' using errcode = 'IZ001';
    end if;

    v_res := public.reservar_canje(v_id);
    if not coalesce((v_res->>'ok')::boolean, false) then
      v_rech := jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', v_res->>'motivo');
      raise exception 'rechazo' using errcode = 'IZ001';
    end if;

    -- La creación no es una transición: no pasa por transicionar
    insert into public.order_events (order_id, type, from_status, to_status, actor, payload)
    values (v_id, 'created', null, v_estado, 'system',
            jsonb_build_object('payment_method', v_o.payment_method, 'total_customer', v_o.total_customer::text,
                               'discount_code', v_codigo));
  exception
    when sqlstate 'IZ001' then
      return v_rech;
    when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'orders_checkout_idempotency_key_key' then
        -- Otra petición con la misma clave ganó la carrera y ya confirmó
        return coalesce(public.pedido_checkout_existente(v_clave, v_o.country_code),
                        jsonb_build_object('ok', false, 'estado', 'existente', 'motivo', 'en_proceso'));
      end if;
      raise;
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
         or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow
         or string_data_right_truncation or invalid_parameter_value then
      get stacked diagnostics v_con = constraint_name, v_col = column_name;
      return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'datos_invalidos',
                                'detalle', coalesce(nullif(v_con, ''), nullif(v_col, ''), sqlstate));
  end;

  return jsonb_build_object('ok', true, 'estado', 'creado', 'repetido', false, 'order', public.pedido_checkout_resumen(v_id));
end;
$$;
comment on function public.crear_pedido_checkout(jsonb) is
  'Crea el pedido del checkout en una transacción (pedido, líneas, reservar_stock, reservar_canje, evento created). Idempotente por checkout_idempotency_key. Solo service_role.';

revoke execute on function public.crear_pedido_checkout(jsonb), public.pedido_checkout_resumen(uuid),
  public.pedido_checkout_existente(text, text) from public, anon, authenticated;
grant execute on function public.crear_pedido_checkout(jsonb), public.pedido_checkout_resumen(uuid),
  public.pedido_checkout_existente(text, text) to service_role;
