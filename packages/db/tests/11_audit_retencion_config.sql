-- Pruebas pgtap · B-n4: el plazo de retención de audit_log es configuración (site_settings.audit_retention_days)
-- y solo postgres y service_role pueden borrar de audit_log (la variable izao.purgar_audit no abre la puerta a otros roles).
begin;
set local search_path = public, extensions;
select plan(9);

select has_column('public', 'site_settings', 'audit_retention_days', 'site_settings tiene audit_retention_days');
select col_default_is('public', 'site_settings', 'audit_retention_days', '180', 'por defecto 180 dias');
select throws_ok($$update public.site_settings set audit_retention_days = 10$$, '23514', null, 'el plazo configurado no puede ser menor a 30');

update public.site_settings set audit_retention_days = 100;
insert into public.audit_log (id, actor, action, entity, entity_id, created_at) values
  ('a0000000-0000-0000-0000-0000000000d1', 'anon', 'login.fallido', 'sesion_admin', 'x', now() - interval '150 days'),
  ('a0000000-0000-0000-0000-0000000000d2', 'anon', 'login.fallido', 'sesion_admin', 'x', now() - interval '50 days');
select is(public.purgar_audit_log(), 1::bigint, 'sin argumento usa el plazo de site_settings (100 dias)');
select is((select count(*)::int from public.audit_log where id in ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d2')), 1,
  'conserva el evento de 50 dias');
select throws_ok($$select public.purgar_audit_log(5)$$, null, null, 'el minimo de 30 dias se mantiene con argumento explicito');

select is((select coalesce(array_agg(distinct coalesce(r.rolname::text, 'PUBLIC') order by coalesce(r.rolname::text, 'PUBLIC')), '{}')
             from pg_class c cross join lateral aclexplode(c.relacl) a left join pg_roles r on r.oid = a.grantee
            where c.oid = 'public.audit_log'::regclass and a.privilege_type in ('DELETE', 'TRUNCATE', 'UPDATE')),
  array['postgres', 'service_role'], 'solo postgres y service_role tienen DELETE, TRUNCATE y UPDATE sobre audit_log');
select is(has_table_privilege('anon', 'public.audit_log', 'delete,truncate,update,insert,select')
       or has_table_privilege('authenticated', 'public.audit_log', 'delete,truncate,update,insert,select'), false,
  'anon y authenticated no tienen ningun privilegio sobre audit_log');
select is(has_function_privilege('anon', 'public.purgar_audit_log(integer)', 'execute')
       or has_function_privilege('authenticated', 'public.purgar_audit_log(integer)', 'execute'), false,
  'purgar_audit_log sigue siendo solo de service_role');

select * from finish();
rollback;
