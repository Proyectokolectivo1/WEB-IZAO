-- RPC atómicas del panel (pedido de izao-admin, docs/estado/izao-admin.md "Para izao-db"). SOLO service_role.
-- Reemplazan pasos sueltos de apps/web/lib/admin/{clientes,pedidos,contenido} por una transacción cada una.
--
-- 1) anonimizar_cliente(p_id uuid) -> jsonb                                         (security definer: borra auth.users)
--    Mismas reglas que lib/admin/clientes: se niega si ya está anonimizado, si tiene cuenta del panel (admin_users), si
--    tiene pedidos en curso (estado fuera de entregado, devuelto, cancelado, expirado, abandonado, pago_rechazado) o
--    garantías abiertas (recibida, en_revision, aprobada). Pedidos del cliente = customer_id, o celular o correo de
--    contacto iguales. Garantías = las de esos pedidos o con el mismo celular o correo.
--    En una transacción: pedidos (contacto, documento y dirección; conserva montos, fechas, estado, ciudad y
--    departamento), mensajes de WhatsApp de esos pedidos, garantías (nombre, celular, correo, descripción), leads
--    (por celular, correo o pedido convertido: se borran), direcciones, lista de deseos, conversaciones con Iza (del
--    cliente o convertidas en sus pedidos: se borran con sus mensajes), cuenta de acceso (auth.users) y por último la
--    ficha con anonymized_at. Si algo falla no queda nada escrito.
--    -> {ok:true, estado:'anonimizado', id, pedidos, mensajes_whatsapp, garantias, leads, direcciones, deseos,
--        conversaciones, cuenta_acceso_eliminada}
--    -> {ok:false, motivo:'datos_invalidos'|'no_existe'|'ya_anonimizado'}
--    -> {ok:false, motivo:'bloqueado', cuenta_del_panel bool, pedidos_en_curso int, garantias_abiertas int}
--
-- 2) cancelar_pedido(p jsonb) -> jsonb       p = {order_id, from_status, actor, motivo?, cancelled_at?}
--    Contrato de @izao/core/order-state: a 'cancelado' solo desde pendiente_manual, enviado_transportadora,
--    en_preparacion y requiere_reembolso (ORDER_TRANSITIONS). En una transacción: aplicar_transicion_pedido (solo si el
--    estado sigue siendo from_status; evento status_changed con payload {motivo}) + liberar_stock (la reserva vuelve;
--    el stock ya confirmado por un pago no se devuelve, igual que hoy). La cancelación en MasterShop va antes, en el
--    servidor (es externa).
--    -> {ok:true, order_id, from_status, to_status:'cancelado', event_id, stock_estado, stock_liberado}
--    -> {ok:false, motivo:'transicion_invalida'|'estado_cambiado'(+status_actual)|'pedido_inexistente'|'datos_invalidos'}
--
-- 3) admin_publicar_pagina(p jsonb) -> jsonb   p = {id?, country_code, kind, slug, title, content_html, seo_title?,
--    seo_description?, status:'draft'|'published', updated_by?}
--    Mismas reglas que guardarPaginaBd: versión = 1 al crear; sube al publicar o al cambiar título/HTML publicado;
--    si queda publicada y kind <> 'general', la publicada anterior del mismo país y tipo pasa a borrador en la MISMA
--    transacción (sin ventana sin página ni restauraciones a mano). Marcadores sin resolver: trigger existente.
--    -> {ok:true, estado:'creada'|'actualizada', id, version, status, publicada_ahora, despublicada:{id,title,
--        country_code}|null, antes:{country_code,kind,slug,title,status,version,seo_title,seo_description,
--        content_length}|null}
--    -> {ok:false, motivo:'no_existe'|'marcadores_pendientes'|'slug_duplicado'|'publicada_duplicada'|'datos_invalidos'
--        (+detalle)}
--
-- 4) catalog_listing.rating_*: ya lo recalcula el trigger catalog_listing_refresh de reviews (20261019031023) en
--    insert, delete y cada update cuyo estado nuevo o anterior sea 'approved' (aprobar, rechazar, devolver a revisión,
--    editar). Sin cambios de esquema; la prueba 31 lo cubre para la moderación.

-- ---------------------------------------------------------------------------------------------------------
-- 1) Anonimizar cliente
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
  v_pedidos uuid[];
  v_en_curso integer;
  v_abiertas integer;
  v_panel boolean;
  n_pedidos integer;
  n_wa integer;
  n_gar integer;
  n_leads integer;
  n_dir integer;
  n_deseos integer;
  n_chat integer;
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

  update public.warranty_claims w
     set customer_name = v_marca, phone = v_marca_tel, email = null, description = null
   where w.order_id = any (v_pedidos)
      or (c.phone_e164 is not null and w.phone = c.phone_e164)
      or (c.email is not null and w.email = c.email);
  get diagnostics n_gar = row_count;

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
                            'deseos', n_deseos, 'conversaciones', n_chat, 'cuenta_acceso_eliminada', v_cuenta);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2) Cancelar pedido y liberar la reserva de stock
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
    -- No debería pasar (el pedido existe y está bloqueado): se deshace la cancelación.
    raise exception 'cancelar_pedido: liberar_stock falló para %', v_id;
  end if;

  return v_t || jsonb_build_object(
    'stock_estado', v_s->>'estado',
    'stock_liberado', (v_s->>'estado') = 'released' and not coalesce((v_s->>'repetido')::boolean, false));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 3) Guardar y publicar una página
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_publicar_pagina(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_antes public.pages;
  v_existe boolean := false;
  v_status text;
  v_kind text;
  v_pais text;
  v_title text;
  v_html text;
  v_version integer;
  v_por uuid;
  v_rep_id uuid;
  v_rep_title text;
  v_rep_pais text;
  v_con text;
  v_col text;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'forma');
  end if;
  begin
    v_id := nullif(p->>'id', '')::uuid;
    v_por := nullif(p->>'updated_by', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'id/updated_by');
  end;
  v_status := p->>'status';
  v_kind := p->>'kind';
  v_pais := p->>'country_code';
  v_title := p->>'title';
  v_html := p->>'content_html';
  if v_status is null or v_kind is null or v_pais is null or v_title is null or v_html is null
     or nullif(p->>'slug', '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'campos_requeridos');
  end if;

  if v_id is not null then
    select * into v_antes from public.pages where id = v_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_existe');
    end if;
    v_existe := true;
  end if;

  -- calcularVersion() de lib/admin/contenido/paginas.ts.
  v_version := case
    when not v_existe then 1
    when v_status <> 'published' then v_antes.version
    when v_antes.status <> 'published' or v_antes.title <> v_title or v_antes.content_html <> v_html then v_antes.version + 1
    else v_antes.version
  end;

  begin
    if v_status = 'published' and v_kind <> 'general' then
      update public.pages g
         set status = 'draft', updated_by = v_por
       where g.country_code = v_pais and g.kind = v_kind and g.status = 'published'
         and g.id is distinct from v_id
      returning g.id, g.title, g.country_code into v_rep_id, v_rep_title, v_rep_pais;
    end if;

    if v_existe then
      update public.pages
         set country_code = v_pais, kind = v_kind, slug = p->>'slug', title = v_title, content_html = v_html,
             seo_title = p->>'seo_title', seo_description = p->>'seo_description', status = v_status,
             version = v_version, updated_by = v_por
       where id = v_id;
    else
      insert into public.pages (country_code, kind, slug, title, content_html, seo_title, seo_description, status,
                                version, updated_by)
      values (v_pais, v_kind, p->>'slug', v_title, v_html, p->>'seo_title', p->>'seo_description', v_status,
              v_version, v_por)
      returning id into v_id;
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      return jsonb_build_object('ok', false, 'motivo',
        case v_con when 'pages_country_code_slug_key' then 'slug_duplicado'
                   when 'pages_pais_tipo_publicada_key' then 'publicada_duplicada'
                   else 'datos_invalidos' end,
        'detalle', v_con);
    when check_violation or not_null_violation or foreign_key_violation then
      get stacked diagnostics v_con = constraint_name, v_col = column_name;
      if sqlstate = '23514' and coalesce(v_con, '') = '' then
        -- enforce_page_publish_markers no tiene nombre de constraint.
        return jsonb_build_object('ok', false, 'motivo', 'marcadores_pendientes');
      end if;
      return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos',
                                'detalle', coalesce(nullif(v_con, ''), nullif(v_col, ''), sqlstate));
  end;

  return jsonb_build_object(
    'ok', true,
    'estado', case when v_existe then 'actualizada' else 'creada' end,
    'id', v_id,
    'version', v_version,
    'status', v_status,
    'publicada_ahora', v_status = 'published' and (not v_existe or v_antes.status <> 'published'),
    'despublicada', case when v_rep_id is null then null
                         else jsonb_build_object('id', v_rep_id, 'title', v_rep_title, 'country_code', v_rep_pais) end,
    'antes', case when not v_existe then null
                  else jsonb_build_object('country_code', v_antes.country_code, 'kind', v_antes.kind, 'slug', v_antes.slug,
                                          'title', v_antes.title, 'status', v_antes.status, 'version', v_antes.version,
                                          'seo_title', v_antes.seo_title, 'seo_description', v_antes.seo_description,
                                          'content_length', length(v_antes.content_html)) end);
end;
$$;

revoke all on function public.anonimizar_cliente(uuid) from public, anon, authenticated;
revoke all on function public.cancelar_pedido(jsonb) from public, anon, authenticated;
revoke all on function public.admin_publicar_pagina(jsonb) from public, anon, authenticated;
grant execute on function public.anonimizar_cliente(uuid) to service_role;
grant execute on function public.cancelar_pedido(jsonb) to service_role;
grant execute on function public.admin_publicar_pagina(jsonb) to service_role;
