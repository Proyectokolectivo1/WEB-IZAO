-- Eliminar productos desde el panel (D-055) y retiro de la verificación en dos pasos (D-054).
--
-- 1) admin_eliminar_producto(p jsonb {product_id}) -> jsonb. Solo service_role, security invoker, search_path vacío.
--      Regla única, en una transacción:
--        - Si el producto o alguna de sus variantes está en `order_items` (pedidos, y por tanto garantías y métricas
--          que salen de ellos), NO se borra: se archiva (`products.status = 'archived'`). El trigger de
--          `catalog_listing` lo saca de la tienda, la búsqueda, el sitemap y el chatbot (`is_visible` exige
--          `status = 'active'`). Los pedidos quedan intactos con sus copias (`name_snapshot`, `sku`, precios).
--        - Si no está referenciado, se borra físicamente: la cascada de las FK limpia categorías, países, opciones,
--          variantes, precios por país (con sus enlaces MasterShop), imágenes, colecciones, reseñas y favoritos.
--          Además: se quita el id de `discount_codes.target_ids/exclude_ids` (no hay FK) y las imágenes (`media`) que
--          quedaron sin ningún otro uso se borran y se encolan en `media_file_deletions` para que el worker quite los
--          archivos del disco. Una imagen que otro producto, banner, categoría, etc. sigue usando NO se toca.
--      Nunca llama a MasterShop: el producto del proveedor no se modifica.
--      Respuesta: {ok:true, accion:'eliminado'|'archivado'|'ya_archivado', pedidos, ...} | {ok:false, motivo:'no_existe'|'datos_invalidos'}.
--
-- 2) media_file_deletions.reason admite 'producto_eliminado'.
--
-- 3) admin_users.mfa_required deja de exigirse: el panel entra con correo y contraseña (la columna se conserva
--    solo informativa; el código ya no la lee). Se deja en false por defecto y en las filas existentes.
--    Ninguna política RLS ni función SQL del proyecto exige `aal2`/`amr` (verificado).

alter table public.media_file_deletions drop constraint if exists media_file_deletions_reason_check;
alter table public.media_file_deletions
  add constraint media_file_deletions_reason_check check (reason in ('anonimizacion', 'producto_eliminado'));

alter table public.admin_users alter column mfa_required set default false;
update public.admin_users set mfa_required = false where mfa_required;

create or replace function public.admin_eliminar_producto(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_prod record;
  v_variantes uuid[];
  v_skus text[];
  v_pedidos integer;
  v_media uuid[];
  v_m uuid;
  v_r record;
  v_usado boolean;
  v_borradas integer := 0;
  v_conservadas integer := 0;
  v_codigos integer := 0;
begin
  begin
    v_id := (p ->> 'product_id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end;
  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  select pr.id, pr.name, pr.slug, pr.status into v_prod from public.products pr where pr.id = v_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  select coalesce(array_agg(v.id), '{}'), coalesce(array_agg(v.sku order by v.sku), '{}')
    into v_variantes, v_skus
    from public.product_variants v where v.product_id = v_id;

  select count(distinct oi.order_id)::integer into v_pedidos
    from public.order_items oi
   where oi.product_id = v_id or oi.variant_id = any (v_variantes);

  -- Con historial: archivar (conserva pedidos, garantías y métricas).
  if v_pedidos > 0 then
    if v_prod.status = 'archived' then
      return jsonb_build_object('ok', true, 'accion', 'ya_archivado', 'pedidos', v_pedidos, 'name', v_prod.name, 'slug', v_prod.slug, 'skus', to_jsonb(v_skus));
    end if;
    update public.products set status = 'archived' where id = v_id;
    return jsonb_build_object('ok', true, 'accion', 'archivado', 'pedidos', v_pedidos, 'name', v_prod.name, 'slug', v_prod.slug, 'skus', to_jsonb(v_skus));
  end if;

  -- Sin historial: borrado físico. Imágenes candidatas (galería y la propia de cada variante).
  select coalesce(array_agg(distinct u), '{}') into v_media from (
    select pi.media_id as u from public.product_images pi where pi.product_id = v_id
    union
    select v.image_id from public.product_variants v where v.product_id = v_id and v.image_id is not null
  ) x;

  -- Códigos de descuento que apuntaban al producto (sin FK).
  update public.discount_codes
     set target_ids = array_remove(target_ids, v_id), exclude_ids = array_remove(exclude_ids, v_id)
   where v_id = any (target_ids) or v_id = any (exclude_ids);
  get diagnostics v_codigos = row_count;

  delete from public.products where id = v_id;
  delete from public.catalog_listing where product_id = v_id;

  -- Imágenes sin ningún otro uso: se borra la fila y se encola el borrado de los archivos.
  foreach v_m in array v_media loop
    v_usado := false;
    for v_r in
      select c.conrelid::regclass::text as tabla, a.attname::text as columna
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.media'::regclass
    loop
      execute format('select exists (select 1 from %s where %I = $1)', v_r.tabla, v_r.columna) into v_usado using v_m;
      exit when v_usado;
    end loop;
    if v_usado then
      v_conservadas := v_conservadas + 1;
    else
      with d as (
        delete from public.media m where m.id = v_m and m.kind = 'product'
        returning m.id, m.kind, m.base_path, m.variants
      )
      insert into public.media_file_deletions (media_id, kind, base_path, variants, reason)
      select d.id, d.kind, d.base_path, d.variants, 'producto_eliminado' from d;
      if found then v_borradas := v_borradas + 1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'accion', 'eliminado', 'pedidos', 0, 'name', v_prod.name, 'slug', v_prod.slug,
    'skus', to_jsonb(v_skus), 'variantes', coalesce(array_length(v_variantes, 1), 0),
    'imagenes_borradas', v_borradas, 'imagenes_compartidas', v_conservadas, 'codigos_actualizados', v_codigos
  );
end;
$$;

comment on function public.admin_eliminar_producto(jsonb) is
  'Elimina un producto: si tiene pedidos lo archiva (conserva el historial); si no, lo borra en cascada y deja en cola los archivos de imagen que nadie más usa. No toca MasterShop.';

revoke all on function public.admin_eliminar_producto(jsonb) from public, anon, authenticated;
grant execute on function public.admin_eliminar_producto(jsonb) to service_role;
