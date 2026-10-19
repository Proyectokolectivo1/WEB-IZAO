-- A-2 · Retención de los eventos de acceso (entity = 'sesion_admin'): audit_log sigue siendo de solo agregar,
-- salvo que la función purgar_audit_log() borre eventos de acceso más antiguos que el plazo. Así un atacante que
-- llene la bitácora con intentos de login no la hace crecer sin límite. Aditiva y reversible (restaurar la función
-- audit_log_append_only anterior y `drop function purgar_audit_log`).
--
-- El trigger deja pasar un DELETE solo si se cumplen TODAS: la variable de sesión local izao.purgar_audit = 'on'
-- (la fija la función), la fila es un evento de acceso y tiene más de 30 días. UPDATE y TRUNCATE siguen prohibidos.

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('izao.purgar_audit', true), '') = 'on'
     and old.entity = 'sesion_admin'
     and old.created_at < now() - interval '30 days' then
    return old;
  end if;
  raise exception 'audit_log es de solo agregar (% no permitido)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Devuelve cuántos eventos de acceso borró. Plazo mínimo 30 días. Security invoker: corre con los privilegios de
-- quien la llama (service_role), que es el único con permiso de ejecutarla.
create or replace function public.purgar_audit_log(p_dias integer default 180)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_n bigint;
begin
  if p_dias is null or p_dias < 30 then
    raise exception 'El plazo mínimo de retención es de 30 días (recibido: %)', p_dias;
  end if;
  perform set_config('izao.purgar_audit', 'on', true);
  delete from public.audit_log
   where entity = 'sesion_admin'
     and created_at < now() - make_interval(days => p_dias);
  get diagnostics v_n = row_count;
  perform set_config('izao.purgar_audit', 'off', true);
  return v_n;
end;
$$;
comment on function public.purgar_audit_log(integer) is
  'Borra eventos de acceso (entity = sesion_admin) más antiguos que p_dias (mínimo 30, por defecto 180). Solo service_role. Programar a diario desde el worker.';

revoke execute on function public.purgar_audit_log(integer) from public, anon, authenticated;
grant execute on function public.purgar_audit_log(integer) to service_role;
