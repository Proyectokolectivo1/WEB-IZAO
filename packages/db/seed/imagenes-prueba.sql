-- T2.9 · Imágenes de prueba para 20 productos del catálogo de prueba (sin binarios en el repo).
--
-- Crea por producto dos filas en `media` (principal y hover, kind 'product') con rutas bajo `product/prueba/`
-- que siguen el patrón del pipeline (§27.1: `{base}-{ancho}.webp`, anchos 400/800/1600, 1200x1500 = 4:5) y las
-- enlaza en `product_images`. Los archivos no existen: la tienda debe tolerar la imagen rota o servir un
-- marcador en `/media/product/prueba/*` en desarrollo.
--
-- Idempotente: solo toma productos activos de prueba (sku 'IZ-%') que aún no tienen imágenes, hasta completar
-- 20 con imágenes de prueba. Marca: media.original_name = 'prueba-t2.9'. Los triggers refrescan catalog_listing.
-- Deshacer (solo datos de prueba):
--   delete from public.media where original_name = 'prueba-t2.9';   -- product_images cae por cascada
begin;

with ya as (
  select count(distinct pi.product_id) as n
    from public.product_images pi join public.media m on m.id = pi.media_id
   where m.original_name = 'prueba-t2.9'
),
elegidos as (
  select p.id, p.slug, p.name
    from public.products p
   where p.status = 'active'
     and exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku like 'IZ-%')
     and not exists (select 1 from public.product_images pi where pi.product_id = p.id)
   order by (select min(v.sku) from public.product_variants v where v.product_id = p.id)
   limit greatest(20 - (select n from ya), 0)
),
nuevas as (
  insert into public.media (kind, base_path, original_name, width, height, variants, lqip, alt, bytes)
  select 'product',
         'product/prueba/' || e.slug || '-' || r.rol,
         'prueba-t2.9', 1200, 1500,
         jsonb_build_object('400', 'product/prueba/' || e.slug || '-' || r.rol || '-400.webp',
                            '800', 'product/prueba/' || e.slug || '-' || r.rol || '-800.webp',
                            '1600', 'product/prueba/' || e.slug || '-' || r.rol || '-1600.webp'),
         -- LQIP: GIF 1x1 válido; la tienda lo usa como fondo mientras carga
         'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
         e.name || case r.rol when 'hover' then ' (vista alterna)' else '' end,
         null
    from elegidos e cross join (values ('primary'), ('hover')) r(rol)
  returning id, base_path
)
insert into public.product_images (product_id, media_id, sort_order, role)
select e.id, n.id, case when n.base_path like '%-hover' then 1 else 0 end,
       case when n.base_path like '%-hover' then 'hover' else 'primary' end
  from nuevas n
  join elegidos e on n.base_path in ('product/prueba/' || e.slug || '-primary', 'product/prueba/' || e.slug || '-hover');

select count(distinct pi.product_id) as productos_con_imagen_de_prueba
  from public.product_images pi join public.media m on m.id = pi.media_id
 where m.original_name = 'prueba-t2.9';

commit;
