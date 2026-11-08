-- Corrige 20261108233306 (D-052): en admin_importar_catalogo, `v_errores || objeto || {paises}` es asociativo a la
-- izquierda y agregaba paises como un elemento aparte del arreglo errores (rompe el esquema del panel). Ahora cada
-- error con motivo sin_vinculo_mastershop trae paises dentro del mismo objeto. Solo redefine la función.
-- Reversión: volver a crear la función desde 20261020044538 (sin paises).

create or replace function public.admin_importar_catalogo(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_modo text := p ->> 'modo';
  v_prev text := coalesce(current_setting('izao.skip_catalog_refresh', true), '');
  v_f jsonb;
  v_i int;
  v_pid uuid;
  v_r jsonb;
  v_antes jsonb;
  v_despues jsonb;
  v_campos jsonb;
  v_slug text;
  v_skus text[];
  v_slugs text[] := '{}';
  v_todos_skus text[] := '{}';
  v_rep text;
  v_ids uuid[] := '{}';
  v_creados int := 0;
  v_actualizados int := 0;
  v_sin_cambios int := 0;
  v_errores jsonb := '[]'::jsonb;
  v_cambios jsonb := '[]'::jsonb;
begin
  if v_modo is null or v_modo not in ('simular', 'aplicar') then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'modo debe ser simular o aplicar');
  end if;
  if jsonb_typeof(p -> 'filas') <> 'array' or jsonb_array_length(p -> 'filas') > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'filas debe ser un arreglo de hasta 1000 productos');
  end if;

  perform set_config('izao.skip_catalog_refresh', 'on', true);
  for v_f, v_i in select x, (n - 1)::int from jsonb_array_elements(p -> 'filas') with ordinality t(x, n) loop
    v_r := null;
    v_campos := '[]'::jsonb;
    v_antes := null;
    v_slug := v_f -> 'product' ->> 'slug';
    v_skus := array(select x ->> 'sku' from jsonb_array_elements(case when jsonb_typeof(v_f -> 'variants') = 'array' then v_f -> 'variants' else '[]'::jsonb end) x);

    -- Repetidos dentro del mismo archivo
    if v_slug = any(v_slugs) then
      v_r := jsonb_build_object('ok', false, 'motivo', 'slug_duplicado', 'detalle', v_slug || ' repetido en el archivo');
    else
      select string_agg(s, ', ') into v_rep from unnest(v_skus) s where s = any(v_todos_skus);
      if v_rep is not null then
        v_r := jsonb_build_object('ok', false, 'motivo', 'sku_duplicado', 'detalle', v_rep || ' repetido en el archivo');
      end if;
    end if;

    if v_r is null then
      v_slugs := v_slugs || v_slug;
      v_todos_skus := v_todos_skus || v_skus;
      v_pid := null;
      begin
        v_pid := nullif(v_f -> 'product' ->> 'id', '')::uuid;
      exception when others then
        v_r := jsonb_build_object('ok', false, 'motivo', 'datos_invalidos', 'detalle', 'product.id');
      end;
      if v_r is null then
        if v_pid is null and v_slug is not null then
          select x.id into v_pid from public.products x where x.slug = v_slug;
          if v_pid is not null then
            v_f := jsonb_set(v_f, '{product,id}', to_jsonb(v_pid));
          end if;
        end if;
        if v_pid is not null then
          v_antes := public.admin_producto_estado(v_pid);
        end if;
        begin
          v_r := public.admin_sync_producto_interno(v_f, false);
          if (v_r ->> 'ok')::boolean then
            v_despues := public.admin_producto_estado((v_r ->> 'product_id')::uuid);
            if (v_r ->> 'creado')::boolean or v_antes is null then
              select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_campos
                from jsonb_object_keys(v_f) k where k <> 'product';
              v_campos := '["product"]'::jsonb || v_campos;
            else
              select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_campos from (
                select 'product.' || a.key as k from jsonb_each(v_despues -> 'product') a
                 where a.value is distinct from (v_antes -> 'product' -> a.key)
                union all
                select a.key from jsonb_each(v_despues) a where a.key <> 'product' and a.value is distinct from (v_antes -> a.key)) d;
            end if;
          end if;
          if v_modo = 'simular' then
            raise exception 'simulacion' using errcode = 'IZ002';
          end if;
        exception when sqlstate 'IZ002' then
          null;  -- se deshace la fila; v_r y v_campos conservan el resultado
        end;
      end if;
    end if;

    if not (v_r ->> 'ok')::boolean then
      -- Paréntesis obligatorios: arreglo || objeto || objeto agregaría paises como un elemento aparte.
      v_errores := v_errores || (jsonb_build_object('indice', v_i, 'motivo', v_r ->> 'motivo', 'detalle', v_r ->> 'detalle',
        'sku', case when v_r ->> 'motivo' in ('sku_duplicado', 'variante_con_pedidos', 'sin_vinculo_mastershop')
                    then split_part(split_part(v_r ->> 'detalle', ', ', 1), ' ', 1) end)
        || case when v_r ? 'paises' then jsonb_build_object('paises', v_r -> 'paises') else '{}'::jsonb end);
    elsif (v_r ->> 'creado')::boolean then
      v_creados := v_creados + 1;
      v_cambios := v_cambios || jsonb_build_object('indice', v_i, 'tipo', 'crear', 'campos', v_campos);
      v_ids := v_ids || (v_r ->> 'product_id')::uuid;
    elsif jsonb_array_length(v_campos) = 0 then
      v_sin_cambios := v_sin_cambios + 1;
    else
      v_actualizados := v_actualizados + 1;
      v_cambios := v_cambios || jsonb_build_object('indice', v_i, 'tipo', 'actualizar', 'campos', v_campos);
      v_ids := v_ids || (v_r ->> 'product_id')::uuid;
    end if;
  end loop;
  perform set_config('izao.skip_catalog_refresh', v_prev, true);

  if v_modo = 'aplicar' and cardinality(v_ids) > 0 then
    perform public.refresh_catalog_listing_many(v_ids);
  end if;
  return jsonb_build_object('ok', true, 'modo', v_modo, 'creados', v_creados, 'actualizados', v_actualizados,
                            'sin_cambios', v_sin_cambios, 'errores', v_errores, 'cambios', v_cambios);
end;
$$;

revoke execute on function public.admin_importar_catalogo(jsonb) from public, anon, authenticated;
grant execute on function public.admin_importar_catalogo(jsonb) to service_role;
