-- B10 · Integridad adicional. Aditiva y reversible (drop constraint / restaurar el trigger anterior).
-- 1) El stock reservado nunca supera el stock.
-- 2) Los campos de contra entrega solo tienen valores en pedidos contra entrega.
-- 3) catalog_listing se refresca también al cambiar is_default, sort_order o sku de una variante.

alter table public.variant_countries
  add constraint variant_countries_reserved_check check (stock_reserved <= stock);

alter table public.orders
  add constraint orders_cod_amounts_check
  check (payment_method = 'cod' or (cod_deposit_amount = 0 and cod_collect_amount = 0));

drop trigger catalog_listing_refresh on public.product_variants;
create trigger catalog_listing_refresh
  after update of product_id, is_default, sort_order, sku or delete on public.product_variants
  for each row execute function public.catalog_listing_on_change();
