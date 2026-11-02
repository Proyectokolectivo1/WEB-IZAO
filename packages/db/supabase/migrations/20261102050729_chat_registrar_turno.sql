-- Turno del chat de Iza en una sola transacción (pedido del líder para izao-tienda): reemplaza en
-- apps/web/lib/store/chat/fuente-supabase.ts (guardarTurno) el insert + conteo + update de messages_count, que no era
-- atómico, por una RPC.
--
-- chat_registrar_turno(p_session_id uuid, p_mensajes jsonb, p_ahora timestamptz default now()) -> integer
--   SOLO service_role. p_mensajes es un arreglo (1..20) de objetos
--     {role: 'user'|'assistant'|'tool', content?: text, tool_calls?: jsonb, model?: text,
--      tokens_in?: int >= 0, tokens_out?: int >= 0, cost_usd_micros?: bigint >= 0 (número o texto)}.
--   1) Bloquea la fila de chat_sessions y suma a messages_count el número de mensajes con role 'user'
--      (messages_count = messages_count + n en la misma sentencia; dos turnos a la vez de la misma sesión se
--      serializan por el bloqueo de fila) y fija last_message_at = greatest(last_message_at, p_ahora).
--   2) Inserta los mensajes con created_at = p_ahora + (posición - 1) microsegundos, de modo que el orden del
--      arreglo se conserva al leer el historial por created_at.
--   Devuelve el messages_count nuevo. Sesión inexistente -> P0002. Arreglo o campos inválidos -> 22023.
--   El costo del mes se sigue sumando aparte con chat_registrar_uso (presupuesto global).

create or replace function public.chat_registrar_turno(
  p_session_id uuid, p_mensajes jsonb, p_ahora timestamptz default now())
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usuario integer;
  v_total integer;
begin
  if p_session_id is null or p_ahora is null or p_mensajes is null or jsonb_typeof(p_mensajes) <> 'array'
     or jsonb_array_length(p_mensajes) not between 1 and 20 then
    raise exception 'chat_registrar_turno: sesión, fecha y arreglo de 1 a 20 mensajes son obligatorios'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_mensajes) m
    where jsonb_typeof(m) <> 'object'
       or coalesce(m->>'role', '') not in ('user', 'assistant', 'tool')
       or (m ? 'tool_calls' and jsonb_typeof(m->'tool_calls') not in ('array', 'object', 'null'))
       or coalesce(m->>'tokens_in', '0') !~ '^[0-9]{1,9}$'
       or coalesce(m->>'tokens_out', '0') !~ '^[0-9]{1,9}$'
       or coalesce(m->>'cost_usd_micros', '0') !~ '^[0-9]{1,18}$'
  ) then
    raise exception 'chat_registrar_turno: mensaje inválido (role, tool_calls, tokens o costo)' using errcode = '22023';
  end if;

  select count(*)::integer into v_usuario from jsonb_array_elements(p_mensajes) m where m->>'role' = 'user';

  update public.chat_sessions s
     set messages_count = s.messages_count + v_usuario,
         last_message_at = greatest(coalesce(s.last_message_at, p_ahora), p_ahora)
   where s.id = p_session_id
  returning s.messages_count into v_total;

  if not found then
    raise exception 'chat_registrar_turno: la sesión % no existe', p_session_id using errcode = 'P0002';
  end if;

  insert into public.chat_messages (session_id, role, content, tool_calls, model, tokens_in, tokens_out,
                                    cost_usd_micros, created_at)
  select p_session_id, m->>'role', m->>'content', nullif(m->'tool_calls', 'null'::jsonb), m->>'model',
         coalesce((m->>'tokens_in')::integer, 0), coalesce((m->>'tokens_out')::integer, 0),
         coalesce((m->>'cost_usd_micros')::bigint, 0), p_ahora + (o - 1) * interval '1 microsecond'
    from jsonb_array_elements(p_mensajes) with ordinality as t(m, o)
   order by o;

  return v_total;
end;
$$;

revoke all on function public.chat_registrar_turno(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_registrar_turno(uuid, jsonb, timestamptz) to service_role;
