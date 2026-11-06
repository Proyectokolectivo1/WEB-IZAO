-- 02b · Restaurar el catálogo de prueba del seed (revierte el 02)
-- Devuelve cada producto archivado por la carga real a su estado anterior y quita la marca. No toca nada más.
-- Generado por apps/web/scripts/carga-catalogo-real.ts. No editar a mano: vuelve a generarlo.

begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _restaurar on commit drop as
select p.id as pid, p.attributes -> 'archivado_por_carga_real' ->> 'estado_anterior' as estado_anterior
  from public.products p
 where p.attributes ? 'archivado_por_carga_real';

update public.products p
   set status = r.estado_anterior,
       attributes = p.attributes - 'archivado_por_carga_real'
  from _restaurar r
 where p.id = r.pid and r.estado_anterior in ('draft','active');

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', 'catalogo.restaurar_seed', 'products', null,
       jsonb_build_object('productos_restaurados', (select count(*) from _restaurar))
 where exists (select 1 from _restaurar);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _restaurar));

select count(*) as productos_restaurados from _restaurar;
commit;
