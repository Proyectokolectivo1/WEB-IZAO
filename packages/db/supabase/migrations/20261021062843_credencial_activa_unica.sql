-- Una sola credencial activa por proveedor y país, y activación atómica (pedido de izao-admin, docs/estado/izao-admin.md).
--
-- integration_credentials_one_active_key: único parcial (provider, country_code) where is_active, NULLS NOT DISTINCT
-- (country_code null = credencial global, p. ej. OpenRouter). No incluye environment: la fila activa ES la que decide
-- el entorno (sandbox o production) de ese proveedor y país; con environment sería redundante con
-- integration_credentials_provider_country_env_key. Activar una segunda fila del mismo grupo -> 23505.
--
-- activar_credencial_integracion(p_id uuid) -> jsonb. SOLO service_role (panel /admin/integraciones).
-- En una transacción bloquea todas las filas de (provider, country_code) en orden por id y:
--   - la pedida ya es la activa -> {ok:true, estado:'ya_activa', id, provider, country_code, environment}
--   - si no                     -> apaga la anterior y enciende la pedida
--                                  -> {ok:true, estado:'activada', id, provider, country_code, environment,
--                                      anterior_id, anterior_environment}  (anterior_* null si no había activa)
--   - {ok:false, motivo:'datos_invalidos'|'no_existe'}
-- Ambos UPDATE se confirman juntos: nunca hay dos activas ni un instante visible sin la nueva.
-- El índice no es diferible: primero se apaga la anterior, luego se enciende la pedida.

create unique index integration_credentials_one_active_key
  on public.integration_credentials (provider, country_code) nulls not distinct
  where is_active;

create or replace function public.activar_credencial_integracion(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.integration_credentials;
  v_activa public.integration_credentials;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  select * into v_c from public.integration_credentials where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  -- Serializa por (provider, country_code): bloquea todas sus filas en orden estable (sin interbloqueo).
  perform 1 from public.integration_credentials
   where provider = v_c.provider and country_code is not distinct from v_c.country_code
   order by id
   for update;

  select * into v_c from public.integration_credentials where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  select * into v_activa from public.integration_credentials
   where provider = v_c.provider and country_code is not distinct from v_c.country_code and is_active;

  if v_activa.id = v_c.id then
    return jsonb_build_object('ok', true, 'estado', 'ya_activa', 'id', v_c.id, 'provider', v_c.provider,
                              'country_code', v_c.country_code, 'environment', v_c.environment);
  end if;

  if v_activa.id is not null then
    update public.integration_credentials set is_active = false where id = v_activa.id;
  end if;
  update public.integration_credentials set is_active = true where id = p_id;

  return jsonb_build_object('ok', true, 'estado', 'activada', 'id', v_c.id, 'provider', v_c.provider,
                            'country_code', v_c.country_code, 'environment', v_c.environment,
                            'anterior_id', v_activa.id, 'anterior_environment', v_activa.environment);
end;
$$;

comment on function public.activar_credencial_integracion(uuid) is
  'Deja la credencial como la única activa de su proveedor y país en una transacción. jsonb {ok, estado|motivo}. Solo service_role.';

revoke execute on function public.activar_credencial_integracion(uuid) from public, anon, authenticated;
grant execute on function public.activar_credencial_integracion(uuid) to service_role;
