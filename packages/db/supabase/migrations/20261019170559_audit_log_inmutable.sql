-- B6 · La bitácora de auditoría es de solo agregar: se impide UPDATE, DELETE y TRUNCATE con triggers
-- y se añade el índice (action, created_at) para filtrar por acción. Aditiva y reversible (drop trigger / drop index).
-- La retención, si algún día se define, se hará con una migración que lo permita explícitamente.

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log es de solo agregar (% no permitido)', tg_op
    using errcode = 'restrict_violation';
end;
$$;
revoke execute on function public.audit_log_append_only() from public, anon, authenticated;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

create index audit_log_action_created_idx on public.audit_log (action, created_at desc);
