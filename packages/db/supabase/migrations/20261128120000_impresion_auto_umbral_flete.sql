-- D-062 · Umbral de flete para la impresión automática de la guía, por país (editable en el panel).
--
-- Si el flete elegido del pedido (`shipments.shipping_rate`, unidad menor) SUPERA el umbral, el worker no crea el
-- `print_job` automático: deja el evento `transportadora` `impresion_manual_requerida` y la alerta para que el
-- administrador llame al cliente e imprima a mano desde el detalle del pedido. `null` = sin límite (todo se imprime
-- solo). Valor inicial del dueño: CO = 25000 COP; EC queda `null` hasta que el dueño lo defina.
--
-- Además, un índice único parcial hace que la retención se registre una sola vez por pedido aunque `poll_label` y la
-- sincronización corran a la vez (insertar otra → 23505, el worker lo trata como ya registrada).
--
-- Aditiva. Reversión:
--   drop index if exists public.order_events_impresion_manual_unica_key;
--   alter table public.country_settings drop column if exists auto_print_max_shipping_rate;

alter table public.country_settings
  add column auto_print_max_shipping_rate bigint
  constraint country_settings_auto_print_max_shipping_rate_check
    check (auto_print_max_shipping_rate is null or auto_print_max_shipping_rate >= 0);

comment on column public.country_settings.auto_print_max_shipping_rate is
  'Flete máximo (unidad menor de la moneda del país) para imprimir la guía automáticamente. Si shipments.shipping_rate lo supera, la guía se imprime a mano desde el panel. null = sin límite (D-062).';

update public.country_settings set auto_print_max_shipping_rate = 25000 where country_code = 'CO';

create unique index order_events_impresion_manual_unica_key
  on public.order_events (order_id)
  where type = 'transportadora' and payload ->> 'accion' = 'impresion_manual_requerida';

comment on index public.order_events_impresion_manual_unica_key is
  'Una retención de impresión automática (impresion_manual_requerida) por pedido (D-062). Otra → 23505.';
