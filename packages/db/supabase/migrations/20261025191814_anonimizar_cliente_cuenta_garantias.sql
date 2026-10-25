-- Corrige 20261025191446: anonimizar_cliente contaba 'garantias' una vez por foto (el unnest multiplicaba filas).
-- Ahora cuenta garantías distintas. Sin otros cambios de contrato.

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
    returning w.id, a.fotos
  )
  select count(distinct g.id)::integer, coalesce(array_agg(distinct f) filter (where f is not null), '{}')
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
grant execute on function public.anonimizar_cliente(uuid) to service_role;
