-- Columnas que FilaVentasDiarias (@izao/core/metrics, §21.2/§21.4) escribe y que faltaban en daily_sales_stats.
-- Enteros y montos en bigint (unidad menor de la moneda de la fila), not null default 0 y no negativos.
-- RLS y privilegios de la tabla no cambian (sin políticas: solo el servidor con la llave secreta).
alter table public.daily_sales_stats
  add column orders_abandoned integer not null default 0
    constraint daily_sales_stats_orders_abandoned_check check (orders_abandoned >= 0),
  add column confirmed_revenue bigint not null default 0
    constraint daily_sales_stats_confirmed_revenue_check check (confirmed_revenue >= 0),
  add column carrier_platform_fees bigint not null default 0
    constraint daily_sales_stats_carrier_platform_fees_check check (carrier_platform_fees >= 0),
  add column shipping_estimated_count integer not null default 0
    constraint daily_sales_stats_shipping_estimated_count_check check (shipping_estimated_count >= 0);

comment on column public.daily_sales_stats.orders_abandoned is 'Pedidos en estado abandonado (para % de abonos pagados).';
comment on column public.daily_sales_stats.confirmed_revenue is 'Ingreso confirmado del día (§21.2), unidad menor de currency_code.';
comment on column public.daily_sales_stats.carrier_platform_fees is 'Comisión de plataforma de la transportadora (MasterShop), unidad menor de currency_code.';
comment on column public.daily_sales_stats.shipping_estimated_count is 'Pedidos cuyo costo de envío aún es estimado (sin costo real de la transportadora).';
