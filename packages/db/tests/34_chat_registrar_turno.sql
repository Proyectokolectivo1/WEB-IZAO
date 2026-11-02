-- Pruebas pgtap · 20261102050729: chat_registrar_turno (mensajes + messages_count en una sola transacción).
begin;
set local search_path = public, extensions;
select plan(14);

select ok(not has_function_privilege('anon', 'public.chat_registrar_turno(uuid, jsonb, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.chat_registrar_turno(uuid, jsonb, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.chat_registrar_turno(uuid, jsonb, timestamptz)', 'execute'),
          'chat_registrar_turno: solo service_role');

insert into public.chat_sessions (id, country_code, visitor_id)
values ('00000000-0000-4000-8000-0000000c4a71', 'CO', 'pgtap-turno');

select is(public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a71',
  '[{"role":"user","content":"hola"},
    {"role":"assistant","content":"¿En qué te ayudo?","tool_calls":[{"n":"buscar"}],"model":"m1",
     "tokens_in":10,"tokens_out":20,"cost_usd_micros":"480000"}]'::jsonb, '1990-05-01 12:00Z'),
  1, 'primer turno: cuenta solo el mensaje de la persona');
select is((select count(*)::int from public.chat_messages where session_id = '00000000-0000-4000-8000-0000000c4a71'),
  2, 'inserta los dos mensajes');
select is((select cost_usd_micros from public.chat_messages
            where session_id = '00000000-0000-4000-8000-0000000c4a71' and role = 'assistant'),
  480000::bigint, 'costo en texto llega como bigint');
select ok((select (array_agg(role order by created_at))[1:2] = array['user', 'assistant']
             from public.chat_messages where session_id = '00000000-0000-4000-8000-0000000c4a71'),
  'el orden del arreglo se conserva por created_at');
select is((select tool_calls from public.chat_messages
            where session_id = '00000000-0000-4000-8000-0000000c4a71' and role = 'assistant'),
  '[{"n":"buscar"}]'::jsonb, 'guarda tool_calls');

select is(public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a71',
  '[{"role":"user","content":"otra"}]'::jsonb, '1990-05-01 12:05Z'), 2, 'segundo turno suma 1 (sin respuesta)');
select is((select last_message_at from public.chat_sessions where id = '00000000-0000-4000-8000-0000000c4a71'),
  '1990-05-01 12:05Z'::timestamptz, 'actualiza last_message_at');
select is(public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a71',
  '[{"role":"user","content":"tarde"}]'::jsonb, '1990-05-01 11:00Z'), 3, 'turno con fecha anterior suma igual');
select is((select last_message_at from public.chat_sessions where id = '00000000-0000-4000-8000-0000000c4a71'),
  '1990-05-01 12:05Z'::timestamptz, 'last_message_at no retrocede');

select throws_ok($$ select public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a7f',
  '[{"role":"user","content":"x"}]'::jsonb) $$, 'P0002', null, 'sesión inexistente -> P0002');
select throws_ok($$ select public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a71', '[]'::jsonb) $$,
  '22023', null, 'arreglo vacío -> 22023');
select throws_ok($$ select public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a71',
  '[{"role":"system","content":"x"}]'::jsonb) $$, '22023', null, 'role system -> 22023');
select throws_ok($$ select public.chat_registrar_turno('00000000-0000-4000-8000-0000000c4a71',
  '[{"role":"assistant","cost_usd_micros":-5}]'::jsonb) $$, '22023', null, 'costo negativo -> 22023');

select * from finish();
rollback;
