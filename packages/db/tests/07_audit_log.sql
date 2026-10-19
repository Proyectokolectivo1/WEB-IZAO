-- Pruebas pgtap · B6: audit_log es de solo agregar y tiene índice (action, created_at).
begin;
set local search_path = public, extensions;
select plan(5);

insert into public.audit_log (id, actor, action, entity, entity_id)
  values ('a0000000-0000-0000-0000-0000000000a6', 'admin:test', 'producto.crear', 'products', 'x');

select lives_ok($$insert into public.audit_log (actor, action, entity) values ('system', 'job.ejecutar', 'jobs')$$,
  'se puede agregar a la bitacora');
select throws_ok($$update public.audit_log set action = 'otra' where id = 'a0000000-0000-0000-0000-0000000000a6'$$,
  '23001', null, 'no se puede modificar la bitacora');
select throws_ok($$delete from public.audit_log where id = 'a0000000-0000-0000-0000-0000000000a6'$$,
  '23001', null, 'no se puede borrar de la bitacora');
select throws_ok($$truncate public.audit_log$$, '23001', null, 'no se puede truncar la bitacora');
select has_index('public', 'audit_log', 'audit_log_action_created_idx', array['action', 'created_at'],
  'indice (action, created_at)');

select * from finish();
rollback;
