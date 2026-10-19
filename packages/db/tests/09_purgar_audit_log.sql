-- Pruebas pgtap · A-2: retención de eventos de acceso. audit_log sigue inmutable salvo purgar_audit_log(), que solo
-- borra eventos de acceso (entity = 'sesion_admin') más antiguos que el plazo.
begin;
set local search_path = public, extensions;
select plan(10);

insert into public.audit_log (id, actor, action, entity, entity_id, created_at) values
  ('a0000000-0000-0000-0000-0000000000a1', 'anon', 'login.fallido', 'sesion_admin', 'x', now() - interval '200 days'),
  ('a0000000-0000-0000-0000-0000000000a2', 'anon', 'login.fallido', 'sesion_admin', 'x', now() - interval '10 days'),
  ('a0000000-0000-0000-0000-0000000000a3', 'admin:1', 'producto.crear', 'products', 'x', now() - interval '400 days');

select throws_ok($$delete from public.audit_log where id = 'a0000000-0000-0000-0000-0000000000a1'$$, '23001', null,
  'un DELETE normal sigue fallando, incluso de eventos de acceso viejos');
select throws_ok($$update public.audit_log set action = 'x' where id = 'a0000000-0000-0000-0000-0000000000a1'$$, '23001', null,
  'un UPDATE sigue fallando');
select throws_ok($$truncate public.audit_log$$, '23001', null, 'TRUNCATE sigue fallando');

select has_function('public', 'purgar_audit_log', array['integer'], 'existe purgar_audit_log(p_dias int)');
select is(has_function_privilege('anon', 'public.purgar_audit_log(integer)', 'execute')
       or has_function_privilege('authenticated', 'public.purgar_audit_log(integer)', 'execute'), false,
  'anon y authenticated no pueden ejecutarla');
select is(has_function_privilege('service_role', 'public.purgar_audit_log(integer)', 'execute'), true,
  'service_role si puede ejecutarla');
select throws_ok($$select public.purgar_audit_log(5)$$, null, null, 'rechaza plazos menores a 30 dias');

select is(public.purgar_audit_log(180), 1::bigint, 'borra solo el evento de acceso mas viejo que el plazo');
select is((select array_agg(id::text order by id) from public.audit_log
            where id in ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a3')),
  array['a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a3'],
  'conserva el evento de acceso reciente y los eventos de otras entidades, aunque sean viejos');
-- La variable de sesion sola no abre la puerta a borrar otras cosas
select set_config('izao.purgar_audit', 'on', true);
select throws_ok($$delete from public.audit_log where id = 'a0000000-0000-0000-0000-0000000000a3'$$, '23001', null,
  'con la variable activa tampoco se borran eventos que no son de acceso');

select * from finish();
rollback;
