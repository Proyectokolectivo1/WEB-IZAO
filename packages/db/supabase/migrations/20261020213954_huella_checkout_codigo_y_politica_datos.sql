-- Pedidos (1), (2) y (3) de izao-pagos (docs/estado/izao-pagos.md). Aditiva; reversible con
--   drop function public.politica_datos_vigente(text), public.pedido_checkout_existente(text, text, text);
--   drop index public.discount_codes_code_key, public.pages_pais_tipo_publicada_key;
--   alter table public.orders drop column checkout_request_hash; alter table public.pages drop column kind;
--   y restaurar crear_pedido_checkout / pedido_checkout_existente(text, text) de 20261020140537.
--
-- (1) orders.checkout_request_hash: huella SHA-256 (hex en minúscula) de la solicitud del checkout (líneas, método,
--     código y dirección; la calcula lib/checkout/huella.ts). Misma clave de idempotencia con huella distinta ->
--     idempotencia_conflicto. Huella nula (en la fila guardada o en la llamada) no choca.
-- (2) discount_codes_code_key: único sobre code. Equivalente a discount_codes_upper_code_idx (upper(code)) por el CHECK
--     code = upper(code), pero usable por `.eq('code', X)` de PostgREST. Se conserva el índice de expresión.
-- (3) pages.kind marca explícitamente las páginas legales; a lo sumo una publicada por (país, kind) salvo 'general'.
--     politica_datos_vigente(país) = version::text de la página 'tratamiento_datos' publicada (o null).
--     crear_pedido_checkout exige que order.data_policy_version sea esa versión.

-- ── (1) Huella de la solicitud ──────────────────────────────────────────────────────────────────
alter table public.orders
  add column checkout_request_hash text
    constraint orders_checkout_request_hash_check check (checkout_request_hash ~ '^[0-9a-f]{64}$');
comment on column public.orders.checkout_request_hash is
  'Huella SHA-256 (hex) de la solicitud del checkout. Misma checkout_idempotency_key con huella distinta = conflicto.';

-- ── (2) Índice único sobre discount_codes.code ──────────────────────────────────────────────────
create unique index discount_codes_code_key on public.discount_codes (code);

-- ── (3) Tipo de página ──────────────────────────────────────────────────────────────────────────
alter table public.pages
  add column kind text not null default 'general'
    constraint pages_kind_check check (kind in ('general', 'quienes_somos', 'envios', 'tratamiento_datos', 'terminos', 'devoluciones'));
comment on column public.pages.kind is
  'Tipo de página. Las legales (todo menos general) tienen a lo sumo una publicada por país. tratamiento_datos da la versión de la política que se acepta en el checkout.';

update public.pages set kind = case slug
    when 'quienes-somos' then 'quienes_somos'
    when 'politica-de-envios' then 'envios'
    when 'tratamiento-de-datos' then 'tratamiento_datos'
    when 'terminos-y-condiciones' then 'terminos'
    when 'devoluciones-y-garantias' then 'devoluciones'
  end
 where slug in ('quienes-somos', 'politica-de-envios', 'tratamiento-de-datos', 'terminos-y-condiciones', 'devoluciones-y-garantias');

create unique index pages_pais_tipo_publicada_key on public.pages (country_code, kind)
  where status = 'published' and kind <> 'general';

create or replace function public.politica_datos_vigente(p_pais text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select p.version::text
    from public.pages p
   where p.country_code = p_pais and p.kind = 'tratamiento_datos' and p.status = 'published';
$$;
comment on function public.politica_datos_vigente(text) is
  'Versión (texto) de la política de tratamiento de datos publicada del país, o null. Es la que se guarda en orders.data_policy_version.';

-- ── Idempotencia con huella ─────────────────────────────────────────────────────────────────────
create or replace function public.pedido_checkout_existente(p_clave text, p_pais text, p_hash text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare o record;
begin
  select id, country_code, checkout_request_hash into o from public.orders where checkout_idempotency_key = p_clave;
  if not found then
    return null;
  end if;
  if o.country_code is distinct from p_pais
     or (p_hash is not null and o.checkout_request_hash is not null and o.checkout_request_hash <> p_hash) then
    return jsonb_build_object('ok', false, 'estado', 'existente', 'motivo', 'idempotencia_conflicto');
  end if;
  if not exists (select 1 from public.order_events e where e.order_id = o.id and e.type = 'created') then
    return jsonb_build_object('ok', false, 'estado', 'existente', 'motivo', 'en_proceso');
  end if;
  return jsonb_build_object('ok', true, 'estado', 'existente', 'repetido', true, 'order', public.pedido_checkout_resumen(o.id));
end;
$$;
comment on function public.pedido_checkout_existente(text, text, text) is
  'Pedido ya creado con esa clave (o null). Conflicto si es de otro país o si ambas huellas existen y difieren. Uso interno de crear_pedido_checkout.';

-- Compatibilidad: la firma anterior delega sin huella
create or replace function public.pedido_checkout_existente(p_clave text, p_pais text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.pedido_checkout_existente(p_clave, p_pais, null::text);
$$;
comment on function public.pedido_checkout_existente(text, text) is
  'Compatibilidad: igual que pedido_checkout_existente(clave, país, null). Uso interno.';

-- ── crear_pedido_checkout: huella y política vigente ───────────────────────────────────────────
create or replace function public.crear_pedido_checkout(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_o public.orders;
  v_clave text;
  v_hash text;
  v_pol text;
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
  v_hash := nullif(btrim(p->'order'->>'checkout_request_hash'), '');
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'datos_invalidos', 'detalle', 'checkout_request_hash');
  end if;
  if jsonb_array_length(p->'items') = 0 then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'sin_items');
  end if;

  -- 1. Idempotencia (doble clic, reintento): antes que la política, un repetido devuelve su pedido
  v_res := public.pedido_checkout_existente(v_clave, p->'order'->>'country_code', v_hash);
  if v_res is not null then
    return v_res;
  end if;

  -- 2. Política de tratamiento de datos: la aceptada debe ser la publicada del país
  v_pol := public.politica_datos_vigente(p->'order'->>'country_code');
  if v_pol is null then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'sin_politica_datos');
  end if;
  if nullif(btrim(p->'order'->>'data_policy_version'), '') is distinct from v_pol then
    return jsonb_build_object('ok', false, 'estado', 'rechazado', 'motivo', 'politica_datos_desactualizada',
                              'version_vigente', v_pol);
  end if;

  -- 3. Todo lo que escribe va en una subtransacción: un rechazo la deshace completa
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
      utm, click_ids, checkout_idempotency_key, checkout_request_hash, terms_accepted_at, data_policy_version, whatsapp_opt_in)
    values (
      v_o.country_code, v_o.currency_code, v_o.customer_id, v_o.contact_first_name, v_o.contact_last_name,
      v_o.contact_phone_e164, v_o.contact_email, v_o.document_type, v_o.document_number, v_o.shipping_region_id,
      v_o.shipping_city_id, v_o.shipping_region_name, v_o.shipping_city_name, v_o.shipping_district, v_o.shipping_address1,
      v_o.shipping_address2, v_o.shipping_zip, v_o.shipping_notes,
      v_o.payment_method, v_estado, v_o.subtotal, v_o.discount_code_id, coalesce(v_o.discount_amount, 0),
      coalesce(v_o.financing_surcharge_pct, 0), coalesce(v_o.financing_surcharge_amount, 0), v_o.total_customer,
      coalesce(v_o.cod_deposit_amount, 0), coalesce(v_o.cod_collect_amount, 0), coalesce(v_o.gateway_fee_estimated, 0),
      coalesce(v_o.product_cost_total, 0), v_o.influencer_id, coalesce(v_o.utm, '{}'::jsonb),
      coalesce(v_o.click_ids, '{}'::jsonb), v_clave, v_hash, v_o.terms_accepted_at, v_pol,
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
        return coalesce(public.pedido_checkout_existente(v_clave, v_o.country_code, v_hash),
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
  'Crea el pedido del checkout en una transacción (pedido, líneas, reservar_stock, reservar_canje, evento created). Idempotente por checkout_idempotency_key y checkout_request_hash; exige la política de datos vigente. Solo service_role.';

revoke execute on function public.politica_datos_vigente(text), public.pedido_checkout_existente(text, text, text),
  public.pedido_checkout_existente(text, text) from public, anon, authenticated;
grant execute on function public.politica_datos_vigente(text), public.pedido_checkout_existente(text, text, text),
  public.pedido_checkout_existente(text, text) to service_role;
