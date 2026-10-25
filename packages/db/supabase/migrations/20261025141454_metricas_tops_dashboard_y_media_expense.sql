-- Tops del dashboard /admin/metricas (§21.3 puntos 5 a 9; §21.4 "tops por SQL directo con índices"). Pedido de
-- izao-admin (docs/estado/izao-admin.md). Además: media.kind = 'expense' para el adjunto de gastos (§22).
--
-- Todas las RPC metricas_* son SOLO service_role (security invoker; el servidor ya salta RLS) y reciben:
--   p_pais text ('CO'|'EC'), p_desde date, p_hasta date (días de America/Bogota, ambos incluidos; máx. 731 días),
--   p_limite int (1..100, default 10) donde aplica. Parámetros inválidos -> error 22023.
-- Periodo (§21.1): pedidos con coalesce(paid_at, created_at) en [p_desde 00:00 Bogotá, p_hasta + 1 00:00 Bogotá),
-- del país y con la moneda del país (igual que lib/admin/metricas/servidor.ts). Montos en bigint (unidad menor).
-- "Pagado" = PAGADOS de @izao/core/metrics (pedido.ts); ingreso confirmado = ingresoConfirmado().
--
--   metricas_top_ciudades(p_pais, p_desde, p_hasta, p_limite)
--     -> (ciudad, departamento, pedidos, ventas_brutas, entregados, devueltos)   solo pagados; orden ventas desc
--   metricas_top_departamentos(p_pais, p_desde, p_hasta, p_limite)
--     -> (departamento, pedidos, ventas_brutas, entregados, devueltos)
--   metricas_top_productos(p_pais, p_desde, p_hasta, p_limite)
--     -> (producto_id, sku, nombre, unidades, ventas, costo, utilidad, unidades_sin_costo)
--        pagados y no devueltos; ventas = Σ(precio × cantidad − descuento de la línea); costo = Σ(costo × cantidad)
--        de las líneas con costo; utilidad = ventas − costo; nombre = products.name (o el de la línea);
--        producto_id null = líneas sin producto, agrupadas por sku.
--   metricas_top_agrupado(p_pais, p_desde, p_hasta, p_dimension, p_limite)   p_dimension: codigo|influencer|fuente
--     -> (clave, etiqueta, pedidos, pagados, ventas_brutas, ingresos_confirmados)   todos los pedidos del periodo
--        codigo: clave = discount_code_id, o 'texto:<CÓDIGO>' si el código se borró; etiqueta = código.
--        influencer: clave = influencer_id; etiqueta = nombre.   fuente: clave = etiqueta = orders.sale_source.
--   metricas_panel_guias(p_pais, p_desde, p_hasta)
--     -> (dimension, estado, grupo, cantidad)   todos los pedidos del periodo, una pasada (grouping sets)
--        'estado_pedido' (estado = orders.status), 'estado_guia' (estado = provider_status_name,
--        grupo = provider_status_parent), 'grupo_guia' (grupo) y 'novedad' (una fila, siempre presente).
--
-- orders.sale_source: columna generada (stored) con fuente_venta(utm, click_ids), equivalente a fuenteDeVenta() de
-- lib/admin/metricas/dashboard.ts: '<utm_source|source> / <utm_medium|medium>' (recortado, minúsculas, 40 car.), o
-- 'meta|google|tiktok (clic de anuncio)' por fbclid/gclid/ttclid, o 'Directo o sin fuente'. Guardarla evita
-- recalcular el JSON en cada consulta y la deja con estadísticas. Si la regla cambia: nueva migración con
-- create or replace + "update public.orders set utm = utm" para recalcular.
--
-- Índice: orders_country_atribucion_idx (country_code, coalesce(paid_at, created_at)): un solo rango por país.
-- Cada RPC fija work_mem = 16MB (con 2MB por defecto los agregados de 100 000 pedidos se ordenaban en disco) y
-- plan_cache_mode = force_custom_plan (el plan se arma con el país, el rango y la dimensión reales; un plan genérico
-- no pliega el case de p_dimension). Medido con 100 000 pedidos en 12 meses: ver docs/estado/izao-db.md.

create or replace function public.fuente_venta(p_utm jsonb, p_click_ids jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when s.origen <> '' and s.medio <> '' then s.origen || ' / ' || s.medio
           when s.origen <> '' then s.origen
           when jsonb_typeof(p_click_ids -> 'fbclid') = 'string' and p_click_ids ->> 'fbclid' <> '' then 'meta (clic de anuncio)'
           when jsonb_typeof(p_click_ids -> 'gclid') = 'string' and p_click_ids ->> 'gclid' <> '' then 'google (clic de anuncio)'
           when jsonb_typeof(p_click_ids -> 'ttclid') = 'string' and p_click_ids ->> 'ttclid' <> '' then 'tiktok (clic de anuncio)'
           else 'Directo o sin fuente'
         end
    from (
      select left(lower(btrim(coalesce(
               case when jsonb_typeof(p_utm -> 'utm_source') = 'string' and btrim(p_utm ->> 'utm_source', e' \t\n\r\f\v') <> ''
                    then p_utm ->> 'utm_source'
                    when jsonb_typeof(p_utm -> 'source') = 'string' then p_utm ->> 'source' end, ''), e' \t\n\r\f\v')), 40) as origen,
             left(lower(btrim(coalesce(
               case when jsonb_typeof(p_utm -> 'utm_medium') = 'string' and btrim(p_utm ->> 'utm_medium', e' \t\n\r\f\v') <> ''
                    then p_utm ->> 'utm_medium'
                    when jsonb_typeof(p_utm -> 'medium') = 'string' then p_utm ->> 'medium' end, ''), e' \t\n\r\f\v')), 40) as medio
    ) s
$$;

alter table public.orders
  add column sale_source text not null generated always as (public.fuente_venta(utm, click_ids)) stored;

create index orders_country_atribucion_idx on public.orders (country_code, (coalesce(paid_at, created_at)));

alter table public.media
  drop constraint media_kind_check,
  add constraint media_kind_check
    check (kind in ('product', 'banner', 'site', 'category', 'review', 'warranty', 'expense'));

-- Estados que cuentan como pagados (constante: el planificador la evalúa una vez por consulta).
create or replace function public.metricas_estados_pagados()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['pagado', 'abono_pagado', 'error_transportadora', 'enviado_transportadora', 'en_preparacion',
               'en_transito', 'entregado', 'devuelto', 'reclamacion']::text[]
$$;

-- Valida parámetros y devuelve los límites UTC del periodo y la moneda del país.
create or replace function public.metricas_periodo(
  p_pais text, p_desde date, p_hasta date, p_limite integer default 10,
  out ini timestamptz, out fin timestamptz, out moneda text)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_pais is null or p_pais not in ('CO', 'EC') then
    raise exception 'país inválido: %', p_pais using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 730 then
    raise exception 'rango de fechas inválido (máximo 731 días)' using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'límite inválido (1 a 100)' using errcode = '22023';
  end if;
  select c.currency_code into moneda from public.countries c where c.code = p_pais;
  if moneda is null then
    raise exception 'país sin moneda: %', p_pais using errcode = '22023';
  end if;
  ini := p_desde::timestamp at time zone 'America/Bogota';
  fin := (p_hasta + 1)::timestamp at time zone 'America/Bogota';
end;
$$;

create or replace function public.metricas_top_ciudades(p_pais text, p_desde date, p_hasta date, p_limite integer default 10)
returns table (ciudad text, departamento text, pedidos integer, ventas_brutas bigint, entregados integer, devueltos integer)
language plpgsql
stable
set search_path = ''
set work_mem = '16MB'
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v record;
begin
  select * into v from public.metricas_periodo(p_pais, p_desde, p_hasta, p_limite);
  return query
  select o.shipping_city_name, o.shipping_region_name,
         count(*)::integer,
         sum(o.total_customer)::bigint,
         (count(*) filter (where o.status = 'entregado'))::integer,
         (count(*) filter (where o.status = 'devuelto'))::integer
    from public.orders o
   where o.country_code = p_pais
     and coalesce(o.paid_at, o.created_at) >= v.ini
     and coalesce(o.paid_at, o.created_at) < v.fin
     and o.currency_code = v.moneda
     and o.status = any (public.metricas_estados_pagados())
   group by o.shipping_city_name, o.shipping_region_name
   order by 4 desc, 3 desc, 1 nulls last, 2 nulls last
   limit p_limite;
end;
$$;

create or replace function public.metricas_top_departamentos(p_pais text, p_desde date, p_hasta date, p_limite integer default 10)
returns table (departamento text, pedidos integer, ventas_brutas bigint, entregados integer, devueltos integer)
language plpgsql
stable
set search_path = ''
set work_mem = '16MB'
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v record;
begin
  select * into v from public.metricas_periodo(p_pais, p_desde, p_hasta, p_limite);
  return query
  select o.shipping_region_name,
         count(*)::integer,
         sum(o.total_customer)::bigint,
         (count(*) filter (where o.status = 'entregado'))::integer,
         (count(*) filter (where o.status = 'devuelto'))::integer
    from public.orders o
   where o.country_code = p_pais
     and coalesce(o.paid_at, o.created_at) >= v.ini
     and coalesce(o.paid_at, o.created_at) < v.fin
     and o.currency_code = v.moneda
     and o.status = any (public.metricas_estados_pagados())
   group by o.shipping_region_name
   order by 3 desc, 2 desc, 1 nulls last
   limit p_limite;
end;
$$;

create or replace function public.metricas_top_productos(p_pais text, p_desde date, p_hasta date, p_limite integer default 10)
returns table (producto_id uuid, sku text, nombre text, unidades integer, ventas bigint, costo bigint, utilidad bigint,
               unidades_sin_costo integer)
language plpgsql
stable
set search_path = ''
set work_mem = '16MB'
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v record;
begin
  select * into v from public.metricas_periodo(p_pais, p_desde, p_hasta, p_limite);
  return query
  with agrupado as (
    select i.product_id,
           max(i.sku) as sku,
           max(i.name_snapshot) as nombre_linea,
           sum(i.quantity)::integer as unidades,
           sum(i.unit_price * i.quantity - i.line_discount)::bigint as ventas,
           coalesce(sum(i.unit_cost * i.quantity), 0)::bigint as costo,
           coalesce(sum(i.quantity) filter (where i.unit_cost is null), 0)::integer as unidades_sin_costo
      from public.orders o
      join public.order_items i on i.order_id = o.id
     where o.country_code = p_pais
       and coalesce(o.paid_at, o.created_at) >= v.ini
       and coalesce(o.paid_at, o.created_at) < v.fin
       and o.currency_code = v.moneda
       and o.status = any (public.metricas_estados_pagados())
       and o.status <> 'devuelto'
     group by i.product_id, case when i.product_id is null then i.sku end
     order by 5 desc, 4 desc, 1 nulls last, 2
     limit p_limite
  )
  select a.product_id, a.sku, coalesce(p.name, a.nombre_linea), a.unidades, a.ventas, a.costo, a.ventas - a.costo,
         a.unidades_sin_costo
    from agrupado a
    left join public.products p on p.id = a.product_id
   order by a.ventas desc, a.unidades desc, a.product_id nulls last, a.sku;
end;
$$;

create or replace function public.metricas_top_agrupado(
  p_pais text, p_desde date, p_hasta date, p_dimension text, p_limite integer default 10)
returns table (clave text, etiqueta text, pedidos integer, pagados integer, ventas_brutas bigint, ingresos_confirmados bigint)
language plpgsql
stable
set search_path = ''
set work_mem = '16MB'
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v record;
begin
  if p_dimension is null or p_dimension not in ('codigo', 'influencer', 'fuente') then
    raise exception 'dimensión inválida: %', p_dimension using errcode = '22023';
  end if;
  select * into v from public.metricas_periodo(p_pais, p_desde, p_hasta, p_limite);
  return query
  with base as (
    select o.status = any (public.metricas_estados_pagados()) as pagado,
           o.total_customer,
           o.discount_code_text,
           case p_dimension when 'codigo' then o.discount_code_id when 'influencer' then o.influencer_id end as ref_id,
           -- ingresoConfirmado() de @izao/core/metrics.
           case
             when o.payment_method = 'cod' then
               case o.status
                 when 'entregado' then o.cod_deposit_amount + o.cod_collect_amount
                 when 'devuelto' then o.cod_deposit_amount
                 when 'reclamacion' then o.cod_deposit_amount
                 else 0
               end
             when o.status in ('enviado_transportadora', 'en_preparacion', 'en_transito', 'entregado', 'devuelto',
                               'reclamacion') then o.total_customer
             else 0
           end::bigint as ingreso,
           case p_dimension
             when 'codigo' then
               coalesce(o.discount_code_id::text,
                        case when nullif(btrim(o.discount_code_text), '') is not null
                             then 'texto:' || upper(btrim(o.discount_code_text)) end)
             when 'influencer' then o.influencer_id::text
             else o.sale_source
           end as clave
      from public.orders o
     where o.country_code = p_pais
       and coalesce(o.paid_at, o.created_at) >= v.ini
       and coalesce(o.paid_at, o.created_at) < v.fin
       and o.currency_code = v.moneda
  ), agrupado as (
    select b.clave,
           b.ref_id,
           max(b.discount_code_text) as texto,
           count(*)::integer as pedidos,
           (count(*) filter (where b.pagado))::integer as pagados,
           coalesce(sum(b.total_customer) filter (where b.pagado), 0)::bigint as ventas_brutas,
           sum(b.ingreso)::bigint as ingresos_confirmados
      from base b
     where b.clave is not null
     group by b.clave, b.ref_id
     order by 6 desc, 4 desc, 1
     limit p_limite
  )
  select a.clave,
         case p_dimension
           when 'codigo' then coalesce(dc.code, a.texto)
           when 'influencer' then coalesce(inf.name, a.clave)
           else a.clave
         end,
         a.pedidos, a.pagados, a.ventas_brutas, a.ingresos_confirmados
    from agrupado a
    left join public.discount_codes dc on p_dimension = 'codigo' and dc.id = a.ref_id
    left join public.influencers inf on p_dimension = 'influencer' and inf.id = a.ref_id
   order by a.ventas_brutas desc, a.pedidos desc, a.clave;
end;
$$;

create or replace function public.metricas_panel_guias(p_pais text, p_desde date, p_hasta date)
returns table (dimension text, estado text, grupo text, cantidad integer)
language plpgsql
stable
set search_path = ''
set work_mem = '16MB'
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v record;
begin
  select * into v from public.metricas_periodo(p_pais, p_desde, p_hasta, 10);
  return query
  with conteo as (
    select case
             when grouping(o.status) = 0 then 'estado_pedido'
             when grouping(s.provider_status_name) = 0 then 'estado_guia'
             when grouping(s.provider_status_parent) = 0 then 'grupo_guia'
             else 'novedad'
           end as dimension,
           case when grouping(o.status) = 0 then o.status else s.provider_status_name end as estado,
           s.provider_status_parent as grupo,
           count(*)::integer as total,
           (count(*) filter (where s.has_novelty))::integer as con_novedad
      from public.orders o
      left join public.shipments s on s.order_id = o.id and s.provider = 'mastershop'
     where o.country_code = p_pais
       and coalesce(o.paid_at, o.created_at) >= v.ini
       and coalesce(o.paid_at, o.created_at) < v.fin
       and o.currency_code = v.moneda
     group by grouping sets ((o.status), (s.provider_status_name, s.provider_status_parent), (s.provider_status_parent), ())
  )
  select c.dimension,
         c.estado,
         case when c.dimension = 'estado_pedido' then null else c.grupo end,
         case when c.dimension = 'novedad' then c.con_novedad else c.total end
    from conteo c
   where not (c.dimension = 'estado_guia' and c.estado is null)
     and not (c.dimension = 'grupo_guia' and c.grupo is null)
   order by 1, 4 desc, 2 nulls first, 3 nulls first;
end;
$$;

-- Solo service_role (el panel llama con la llave secreta). fuente_venta es pura (sin datos) y la evalúa la columna
-- generada en cada insert/update de orders: conserva el execute por defecto.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.metricas_estados_pagados()',
    'public.metricas_periodo(text, date, date, integer)',
    'public.metricas_top_ciudades(text, date, date, integer)',
    'public.metricas_top_departamentos(text, date, date, integer)',
    'public.metricas_top_productos(text, date, date, integer)',
    'public.metricas_top_agrupado(text, date, date, text, integer)',
    'public.metricas_panel_guias(text, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
