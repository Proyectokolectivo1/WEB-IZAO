-- 02 · Archivar el catálogo de prueba del seed (NO borra)
-- Productos cuyas variantes son todas del seed (SKU IZ-NNNN-…) pasan a status archived.
-- Guarda el estado anterior en products.attributes.archivado_por_carga_real para poder revertir (02b-restaurar-seed.sql).
-- Los pedidos existentes siguen apuntando a sus variantes: no se toca ninguna fila de variantes ni de pedidos.
-- Generado por apps/web/scripts/carga-catalogo-real.ts. No editar a mano: vuelve a generarlo.

begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _seed on commit drop as
select p.id as pid, p.status as estado_anterior
  from public.products p
 where p.status <> 'archived'
   and exists (select 1 from public.product_variants v where v.product_id = p.id)
   and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku !~ '^IZ-[0-9]+-')
   and not (p.attributes ? 'archivado_por_carga_real');

update public.products p
   set status = 'archived',
       attributes = p.attributes || jsonb_build_object('archivado_por_carga_real',
                      jsonb_build_object('estado_anterior', s.estado_anterior, 'fecha', to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD"T"HH24:MI:SS')))
  from _seed s
 where p.id = s.pid;

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', 'catalogo.archivar_seed', 'products', null,
       jsonb_build_object('productos_archivados', (select count(*) from _seed))
 where exists (select 1 from _seed);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _seed));

select count(*) as productos_archivados from _seed;
commit;
