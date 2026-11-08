-- 03 · Publicar en Colombia los productos de la carga con vínculo MasterShop
-- Ejecutar DESPUÉS de aplicar la vinculación por SKU (D-050).
-- Publica solo productos active de la carga cuyas variantes activas tienen el vínculo de CO (variant_countries.mastershop_product_id). Los que no lo tengan quedan ocultos.
-- El stock sigue en 0: con stock 0 la tienda muestra «Agotado». Define el stock en el panel (Productos) o en la importación.
-- Generado por apps/web/scripts/carga-catalogo-real.ts. No editar a mano: vuelve a generarlo.

begin;
select set_config('izao.skip_catalog_refresh', 'on', true);

create temp table _publicar on commit drop as
select p.id as pid
  from public.products p
 where p.status = 'active'
   and exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku ~ '^IZAO-(MEN|WOM)-[0-9]{3}$')
   and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku !~ '^IZAO-(MEN|WOM)-[0-9]{3}$')
   and not exists (
         select 1 from public.product_variants v
           join public.variant_countries vc on vc.variant_id = v.id and vc.country_code = 'CO' and vc.is_active
          where v.product_id = p.id and vc.mastershop_product_id is null)
   and exists (select 1 from public.product_countries pc where pc.product_id = p.id and pc.country_code = 'CO' and not pc.is_visible);

update public.product_countries pc
   set is_visible = true, published_at = coalesce(pc.published_at, now())
  from _publicar x
 where pc.product_id = x.pid and pc.country_code = 'CO';

insert into public.audit_log (actor, action, entity, entity_id, diff)
select 'sistema:carga-catalogo-real', 'catalogo.publicar_co', 'products', null,
       jsonb_build_object('productos_publicados', (select count(*) from _publicar))
 where exists (select 1 from _publicar);

select set_config('izao.skip_catalog_refresh', 'off', true);
select public.refresh_catalog_listing_many(array(select pid from _publicar));

select (select count(*) from _publicar) as productos_publicados,
       (select count(*) from public.products p join public.product_countries pc on pc.product_id = p.id and pc.country_code = 'CO' and not pc.is_visible
         where p.status = 'active' and exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku like 'IZAO-%')) as siguen_ocultos;
commit;
