-- Revisión de izao-revisor sobre 20261025143040 (§10.2: el stock "se libera al expirar, abandonar o cancelar").
-- Decisión de negocio: al cancelar, el stock ya descontado por un pago SÍ vuelve al inventario. Ver D-035.
--
-- 1) cancelar_pedido(p jsonb) -> jsonb     (misma entrada; respuesta con campos nuevos, aditivos)
--    En una transacción: transición a 'cancelado' + liberar_stock (reserva) + devolución del stock confirmado:
--    - stock_state 'reserved'  -> se libera la reserva (como antes).
--    - stock_state 'confirmed' -> stock += cantidad por variante del país (filas bloqueadas en orden de variant_id),
--      stock_state = 'released' y evento order_events type 'stock_devuelto' {lineas[{variant_id,sku,cantidad}],
--      no_devueltas[{variant_id,sku,cantidad,motivo}]} (variante borrada o sin fila en el país: no se inventa stock).
--    - EXCEPCIÓN: si la transportadora ya recolectó el paquete (shipments.provider_status_id 5, 6, 8, 10 u 11), el
--      stock NO se devuelve aquí (la mercancía no está en bodega; vuelve por devolución): sigue 'confirmed' y se
--      registra order_events type 'stock_retenido' {motivo:'envio_recolectado', provider_status_id}.
--      MasterShop 1–4 (por confirmar, pendiente, por alistar, por recolectar) y 9 (cancelada) cuentan como sin envío
--      efectivo: el paquete sigue en bodega.
--    -> {ok:true, order_id, from_status, to_status:'cancelado', event_id, stock_estado, stock_liberado,
--        stock_devuelto bool, unidades_devueltas int, stock_retenido 'envio_recolectado'|null}
--    -> {ok:false, ...} sin cambios.
--
-- 2) anonimizar_cliente(p_id uuid) -> jsonb   (mismas reglas y bloqueos; además, en la misma transacción)
--    - payments.raw_last_event = null en los pagos de sus pedidos.
--    - webhook_events ligados: payload recortado a {"anonimizado": true} y error = null (se conservan provider y
--      event_id para la idempotencia). Ligado = algún valor del payload (a cualquier profundidad) es igual a un
--      identificador del cliente: id o número de sus pedidos, referencia/transacción/link de sus pagos, id externo,
--      id de MasterShop o guía de sus envíos, wa_message_id de sus mensajes, celulares (E.164, sin '+' y sin
--      prefijo del país) y correos. Solo eventos desde un día antes del primer registro del cliente.
--    - reviews de sus pedidos (order_id): author_name = 'Cliente anónimo'.
--    - Fotos de garantía: warranty_claims.media_ids = '{}', las filas de media (kind 'warranty') se borran y sus
--      rutas quedan en media_file_deletions para que el worker borre los archivos del disco.
--    -> respuesta con los campos nuevos pagos_limpiados, webhooks_recortados, resenas, fotos_garantia.
--
-- 3) media_file_deletions (nueva): cola de archivos físicos por borrar del disco del VPS.
--    El worker: lee las filas (order by requested_at), borra <raiz media>/<base_path> y cada ruta de `variants`
--    (ignora "no existe"), y al terminar BORRA la fila; si falla, attempts + 1 y last_error. Solo service_role.

-- ---------------------------------------------------------------------------------------------------------
-- 3) Cola de borrado de archivos
-- ---------------------------------------------------------------------------------------------------------
create table public.media_file_deletions (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null,
  kind text not null,
  base_path text not null,
  variants jsonb not null default '{}'::jsonb,
  reason text not null check (reason in ('anonimizacion')),
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.media_file_deletions is 'Archivos de media por borrar del disco (la fila de media ya no existe). El worker borra los archivos y luego la fila.';
create index media_file_deletions_requested_at_idx on public.media_file_deletions (requested_at);
alter table public.media_file_deletions enable row level security;
create trigger media_file_deletions_set_updated_at before update on public.media_file_deletions
  for each row execute function public.set_updated_at();
revoke all on table public.media_file_deletions from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 1) Cancelar pedido: libera la reserva y devuelve el stock confirmado
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.cancelar_pedido(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
  -- ORDER_TRANSITIONS de @izao/core/order-state: estados con 'cancelado' entre sus siguientes.
  if v_de not in ('pendiente_manual', 'enviado_transportadora', 'en_preparacion', 'requiere_reembolso') then
    return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida', 'from_status', v_de);
  end if;

  -- Bloquea el pedido y valida from_status (estado_cambiado si otro proceso lo movió).
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

  -- Reserva sin pagar: vuelve al disponible.
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
      -- La transportadora ya tiene el paquete: el stock vuelve con la devolución, no aquí.
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

  return v_t || jsonb_build_object(
    'stock_estado', v_estado,
    'stock_liberado', (v_s->>'estado') = 'released' and not coalesce((v_s->>'repetido')::boolean, false),
    'stock_devuelto', v_unidades > 0,
    'unidades_devueltas', v_unidades,
    'stock_retenido', v_retenido);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2) Anonimizar cliente (completo)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.anonimizar_cliente(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  v_marca constant text := 'Anonimizado';
  v_marca_tel constant text := 'anonimizado';
  v_marca_resena constant text := 'Cliente anónimo';
  v_pedidos uuid[];
  v_en_curso integer;
  v_abiertas integer;
  v_panel boolean;
  v_prefijo text;
  v_tels text[];
  v_ids_txt text[];
  v_ids_num bigint[];
  v_desde timestamptz;
  v_fotos uuid[];
  n_pedidos integer;
  n_wa integer;
  n_gar integer;
  n_leads integer;
  n_dir integer;
  n_deseos integer;
  n_chat integer;
  n_pagos integer;
  n_webhooks integer;
  n_resenas integer;
  n_fotos integer;
  v_cuenta boolean := false;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  select * into c from public.customers where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  if c.anonymized_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ya_anonimizado');
  end if;

  -- Pedidos del cliente (vinculados o de invitado con su celular o correo), bloqueados hasta el final.
  select coalesce(array_agg(o.id order by o.id), '{}') into v_pedidos
    from (select o.id from public.orders o
           where o.customer_id = c.id
              or (c.phone_e164 is not null and o.contact_phone_e164 = c.phone_e164)
              or (c.email is not null and o.contact_email = c.email)
           order by o.id
           for update) o;

  select count(*)::integer into v_en_curso
    from public.orders o
   where o.id = any (v_pedidos)
     and o.status not in ('entregado', 'devuelto', 'cancelado', 'expirado', 'abandonado', 'pago_rechazado');

  select count(*)::integer into v_abiertas
    from public.warranty_claims w
   where w.status in ('recibida', 'en_revision', 'aprobada')
     and (w.order_id = any (v_pedidos)
          or (c.phone_e164 is not null and w.phone = c.phone_e164)
          or (c.email is not null and w.email = c.email));

  v_panel := c.auth_user_id is not null and exists (select 1 from public.admin_users a where a.auth_user_id = c.auth_user_id);

  if v_panel or v_en_curso > 0 or v_abiertas > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'cuenta_del_panel', v_panel,
                              'pedidos_en_curso', v_en_curso, 'garantias_abiertas', v_abiertas);
  end if;

  -- Identificadores para encontrar los webhooks ligados (antes de borrar o neutralizar nada).
  select ct.phone_prefix into v_prefijo from public.countries ct where ct.code = c.country_code;
  select coalesce(array_agg(distinct t), '{}') into v_tels
    from (select c.phone_e164 as t
          union all select o.contact_phone_e164 from public.orders o where o.id = any (v_pedidos)
          union all select m.to_e164 from public.whatsapp_messages m where m.order_id = any (v_pedidos)) x
   where t is not null and t ~ '^\+[0-9]{6,15}$';

  select coalesce(array_agg(distinct v), '{}') into v_ids_txt
    from (
      select unnest(v_tels) as v
      union all select ltrim(t, '+') from unnest(v_tels) t
      union all select substr(t, length(v_prefijo) + 1) from unnest(v_tels) t
       where v_prefijo is not null and t like v_prefijo || '%'
      union all select c.email::text
      union all select lower(c.email::text)
      union all select o.contact_email::text from public.orders o where o.id = any (v_pedidos)
      union all select lower(o.contact_email::text) from public.orders o where o.id = any (v_pedidos)
      union all select o.id::text from public.orders o where o.id = any (v_pedidos)
      union all select o.number from public.orders o where o.id = any (v_pedidos)
      union all select y.provider_reference from public.payments y where y.order_id = any (v_pedidos)
      union all select y.provider_transaction_id from public.payments y where y.order_id = any (v_pedidos)
      union all select y.payment_link_id from public.payments y where y.order_id = any (v_pedidos)
      union all select s.external_order_id from public.shipments s where s.order_id = any (v_pedidos)
      union all select s.provider_order_id::text from public.shipments s where s.order_id = any (v_pedidos)
      union all select s.tracking_code from public.shipments s where s.order_id = any (v_pedidos)
      union all select m.wa_message_id from public.whatsapp_messages m where m.order_id = any (v_pedidos)
    ) x
   where v is not null and length(v) >= 4;

  select coalesce(array_agg(distinct s.provider_order_id::bigint), '{}') into v_ids_num
    from public.shipments s where s.order_id = any (v_pedidos) and s.provider_order_id is not null;

  select least(c.created_at, min(o.created_at)) - interval '1 day' into v_desde
    from public.orders o where o.id = any (v_pedidos);
  v_desde := coalesce(v_desde, c.created_at - interval '1 day');

  update public.webhook_events w
     set payload = jsonb_build_object('anonimizado', true), error = null
   where w.created_at >= v_desde
     and cardinality(v_ids_txt) + cardinality(v_ids_num) > 0
     and not (w.payload ? 'anonimizado' and w.payload = jsonb_build_object('anonimizado', true))
     and jsonb_path_exists(w.payload, 'lax $.** ? (@ == $s[*] || @ == $n[*])',
                           jsonb_build_object('s', to_jsonb(v_ids_txt), 'n', to_jsonb(v_ids_num)));
  get diagnostics n_webhooks = row_count;

  update public.payments y set raw_last_event = null
   where y.order_id = any (v_pedidos) and y.raw_last_event is not null;
  get diagnostics n_pagos = row_count;

  update public.reviews r set author_name = v_marca_resena
   where r.order_id = any (v_pedidos) and r.author_name <> v_marca_resena;
  get diagnostics n_resenas = row_count;

  update public.orders o
     set contact_first_name = v_marca,
         contact_last_name = '',
         contact_phone_e164 = v_marca_tel,
         contact_email = null,
         document_type = null,
         document_number = null,
         shipping_district = null,
         shipping_address1 = null,
         shipping_address2 = null,
         shipping_zip = null,
         shipping_notes = null
   where o.id = any (v_pedidos);
  get diagnostics n_pedidos = row_count;

  update public.whatsapp_messages m set to_e164 = v_marca_tel where m.order_id = any (v_pedidos);
  get diagnostics n_wa = row_count;

  -- Garantías: neutralizar y soltar las fotos.
  with g as (
    update public.warranty_claims w
       set customer_name = v_marca, phone = v_marca_tel, email = null, description = null, media_ids = '{}'
      from (select w2.id, w2.media_ids as fotos from public.warranty_claims w2
             where w2.order_id = any (v_pedidos)
                or (c.phone_e164 is not null and w2.phone = c.phone_e164)
                or (c.email is not null and w2.email = c.email)
             for update) a
     where w.id = a.id
    returning a.fotos
  )
  select count(*)::integer, coalesce(array_agg(distinct f) filter (where f is not null), '{}')
    into n_gar, v_fotos
    from g left join lateral unnest(g.fotos) f on true;

  with d as (
    delete from public.media m
     where m.id = any (v_fotos) and m.kind = 'warranty'
    returning m.id, m.kind, m.base_path, m.variants
  )
  insert into public.media_file_deletions (media_id, kind, base_path, variants, reason)
  select d.id, d.kind, d.base_path, d.variants, 'anonimizacion' from d;
  get diagnostics n_fotos = row_count;

  delete from public.leads l
   where l.converted_order_id = any (v_pedidos)
      or (c.phone_e164 is not null and l.phone_e164 = c.phone_e164)
      or (c.email is not null and l.email = c.email);
  get diagnostics n_leads = row_count;

  delete from public.addresses a where a.customer_id = c.id;
  get diagnostics n_dir = row_count;

  delete from public.wishlists w where w.customer_id = c.id;
  get diagnostics n_deseos = row_count;

  -- chat_messages se borran en cascada.
  delete from public.chat_sessions s where s.customer_id = c.id or s.converted_order_id = any (v_pedidos);
  get diagnostics n_chat = row_count;

  if c.auth_user_id is not null then
    delete from auth.users u where u.id = c.auth_user_id;
    v_cuenta := found;
  end if;

  update public.customers
     set first_name = null,
         last_name = null,
         email = null,
         phone_e164 = null,
         document_type = null,
         document_number = null,
         marketing_opt_in = false,
         whatsapp_opt_in = false,
         auth_user_id = null,
         anonymized_at = now()
   where id = c.id;

  return jsonb_build_object('ok', true, 'estado', 'anonimizado', 'id', c.id, 'pedidos', n_pedidos,
                            'mensajes_whatsapp', n_wa, 'garantias', n_gar, 'leads', n_leads, 'direcciones', n_dir,
                            'deseos', n_deseos, 'conversaciones', n_chat, 'cuenta_acceso_eliminada', v_cuenta,
                            'pagos_limpiados', n_pagos, 'webhooks_recortados', n_webhooks, 'resenas', n_resenas,
                            'fotos_garantia', n_fotos);
end;
$$;

revoke all on function public.anonimizar_cliente(uuid) from public, anon, authenticated;
revoke all on function public.cancelar_pedido(jsonb) from public, anon, authenticated;
grant execute on function public.anonimizar_cliente(uuid) to service_role;
grant execute on function public.cancelar_pedido(jsonb) to service_role;
