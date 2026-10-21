-- Activación atómica de plantillas de WhatsApp (pedido 1 de izao-pagos, docs/estado/izao-pagos.md).
--
-- activar_plantilla_whatsapp(p_id uuid, p_meta_template_id text default null) -> jsonb. SOLO service_role
-- (worker: job whatsapp.evento al recibir APPROVED de Meta; luego el panel).
-- En una transacción bloquea todas las versiones de (key, country_code) y:
--   - la versión pedida ya es la activa       -> la marca approved      -> {ok:true, estado:'ya_activa', id, version}
--   - la activa es MÁS NUEVA que la pedida     -> la marca approved sin activarla
--                                                -> {ok:true, estado:'aprobada_sin_activar', id, version, activa_id, activa_version}
--   - si no                                     -> desactiva la anterior y activa la pedida (approved, sin motivo de rechazo)
--                                                -> {ok:true, estado:'activada', id, version, anterior_id, anterior_version}
--                                                   (anterior_* null si no había activa)
--   - {ok:false, motivo:'datos_invalidos'|'no_existe'}
-- meta_template_id: si llega, se guarda (coalesce con el que ya tenía).
-- Nunca queda un instante sin versión activa visible para otra sesión: ambos UPDATE se confirman juntos.
-- Dos activaciones simultáneas de la misma clave se serializan por el bloqueo de filas (orden por id, sin interbloqueo).

create or replace function public.activar_plantilla_whatsapp(p_id uuid, p_meta_template_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_t public.whatsapp_templates;
  v_activa public.whatsapp_templates;
  v_meta text := nullif(btrim(p_meta_template_id), '');
begin
  if p_id is null or (v_meta is not null and length(v_meta) > 100) then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  select * into v_t from public.whatsapp_templates where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  -- Serializa por (key, country_code): bloquea todas sus versiones en orden estable.
  perform 1 from public.whatsapp_templates
   where key = v_t.key and country_code = v_t.country_code
   order by id
   for update;

  select * into v_t from public.whatsapp_templates where id = p_id;
  select * into v_activa from public.whatsapp_templates
   where key = v_t.key and country_code = v_t.country_code and is_active;

  if v_activa.id = v_t.id then
    update public.whatsapp_templates
       set meta_status = 'approved', meta_rejection_reason = null,
           meta_template_id = coalesce(v_meta, meta_template_id)
     where id = p_id;
    return jsonb_build_object('ok', true, 'estado', 'ya_activa', 'id', v_t.id, 'version', v_t.version);
  end if;

  if v_activa.id is not null and v_activa.version > v_t.version then
    update public.whatsapp_templates
       set meta_status = 'approved', meta_rejection_reason = null,
           meta_template_id = coalesce(v_meta, meta_template_id)
     where id = p_id;
    return jsonb_build_object('ok', true, 'estado', 'aprobada_sin_activar', 'id', v_t.id, 'version', v_t.version,
                              'activa_id', v_activa.id, 'activa_version', v_activa.version);
  end if;

  -- El índice único parcial whatsapp_templates_one_active_idx no es diferible: primero se desactiva la anterior.
  if v_activa.id is not null then
    update public.whatsapp_templates set is_active = false where id = v_activa.id;
  end if;
  update public.whatsapp_templates
     set is_active = true, meta_status = 'approved', meta_rejection_reason = null,
         meta_template_id = coalesce(v_meta, meta_template_id)
   where id = p_id;

  return jsonb_build_object('ok', true, 'estado', 'activada', 'id', v_t.id, 'version', v_t.version,
                            'anterior_id', v_activa.id, 'anterior_version', v_activa.version);
end;
$$;

comment on function public.activar_plantilla_whatsapp(uuid, text) is
  'Activa una versión de plantilla de WhatsApp y desactiva la anterior en una transacción; no activa si la vigente es más nueva. jsonb {ok, estado|motivo}. Solo service_role.';

revoke execute on function public.activar_plantilla_whatsapp(uuid, text) from public, anon, authenticated;
grant execute on function public.activar_plantilla_whatsapp(uuid, text) to service_role;
