-- Consumo del chat de Iza (§ chatbot, presupuesto mensual global). Pedido del líder para izao-tienda:
-- reemplaza el comparar-y-cambiar de apps/web/lib/store/chat/fuente-supabase.ts por una sola sentencia atómica.
--
-- chat_registrar_uso(p_costo_micros bigint, p_mensajes integer default 1, p_ahora timestamptz default now()) -> bigint
--   SOLO service_role. Suma p_costo_micros (micro-USD) y p_mensajes al mes de p_ahora en hora de Bogotá
--   (primer día del mes, clave de chat_usage_monthly) con insert ... on conflict do update (sin carreras ni
--   reintentos) y devuelve cost_usd_micros acumulado del mes. chat_usage_monthly es global (el presupuesto de
--   chat_settings no es por país). Negativos o nulos -> error 22023.

create or replace function public.chat_registrar_uso(
  p_costo_micros bigint, p_mensajes integer default 1, p_ahora timestamptz default now())
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
begin
  if p_costo_micros is null or p_costo_micros < 0 or p_mensajes is null or p_mensajes < 0 or p_ahora is null then
    raise exception 'chat_registrar_uso: costo y mensajes deben ser >= 0' using errcode = '22023';
  end if;
  insert into public.chat_usage_monthly as u (month, cost_usd_micros, messages)
  values (date_trunc('month', p_ahora at time zone 'America/Bogota')::date, p_costo_micros, p_mensajes)
  on conflict (month) do update
    set cost_usd_micros = u.cost_usd_micros + excluded.cost_usd_micros,
        messages = u.messages + excluded.messages
  returning u.cost_usd_micros into v_total;
  return v_total;
end;
$$;

revoke all on function public.chat_registrar_uso(bigint, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_registrar_uso(bigint, integer, timestamptz) to service_role;
