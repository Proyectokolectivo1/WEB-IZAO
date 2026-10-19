-- B-n4 · El plazo de retención de audit_log es configuración (regla 3): site_settings.audit_retention_days (mínimo 30,
-- por defecto 180). purgar_audit_log() sin argumento lo lee; con argumento explícito se mantiene el mínimo de 30.
-- Solo service_role ejecuta la función. Aditiva y reversible (drop column; restaurar la función anterior).

alter table public.site_settings
  add column audit_retention_days integer not null default 180 check (audit_retention_days >= 30);

comment on column public.site_settings.audit_retention_days is
  'Días que se conservan los eventos de acceso (audit_log.entity = sesion_admin) antes de que purgar_audit_log() los borre. Mínimo 30.';

create or replace function public.purgar_audit_log(p_dias integer default null)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dias integer;
  v_n bigint;
begin
  v_dias := coalesce(p_dias, (select s.audit_retention_days from public.site_settings s limit 1), 180);
  if v_dias < 30 then
    raise exception 'El plazo mínimo de retención es de 30 días (recibido: %)', v_dias;
  end if;
  perform set_config('izao.purgar_audit', 'on', true);
  delete from public.audit_log
   where entity = 'sesion_admin'
     and created_at < now() - make_interval(days => v_dias);
  get diagnostics v_n = row_count;
  perform set_config('izao.purgar_audit', 'off', true);
  return v_n;
end;
$$;
comment on function public.purgar_audit_log(integer) is
  'Borra eventos de acceso (entity = sesion_admin) más antiguos que p_dias o, sin argumento, que site_settings.audit_retention_days (mínimo 30). Solo service_role. Programar a diario desde el worker.';
