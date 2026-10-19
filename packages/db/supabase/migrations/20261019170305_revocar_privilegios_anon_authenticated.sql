-- M7 · Defensa en profundidad: además de RLS, ni `anon` ni `authenticated` tienen privilegios por defecto en `public`.
-- Se revoca todo (tablas, secuencias, funciones, también los privilegios por defecto futuros del rol que crea
-- los objetos) y se vuelve a conceder solo lo de D-011: columnas y tablas del cliente autenticado.
-- Reversible: `grant ... to anon, authenticated` restaura los privilegios anteriores (el servidor usa service_role).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
-- Funciones sin ACL explícita las ejecuta PUBLIC; ninguna función de public es para el navegador.
revoke execute on all functions in schema public from public;

-- Privilegios por defecto de objetos futuros creados por postgres (con y sin esquema)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke all on tables from anon, authenticated;
alter default privileges for role postgres revoke all on sequences from anon, authenticated;
alter default privileges for role postgres revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- Lo único que se concede: cliente autenticado sobre lo suyo (las políticas RLS filtran las filas)
grant select on public.customers to authenticated;
grant update (first_name, last_name, phone_e164, document_type, document_number, marketing_opt_in, whatsapp_opt_in)
  on public.customers to authenticated;
grant select on public.addresses to authenticated;
grant select on public.wishlists to authenticated;
grant select (
  id, number, country_code, currency_code, customer_id,
  contact_first_name, contact_last_name, contact_phone_e164, contact_email, document_type, document_number,
  shipping_region_id, shipping_city_id, shipping_region_name, shipping_city_name, shipping_district,
  shipping_address1, shipping_address2, shipping_zip, shipping_notes,
  payment_method, status, subtotal, discount_amount, financing_surcharge_pct, financing_surcharge_amount,
  total_customer, cod_deposit_amount, cod_collect_amount, public_token,
  stock_reserved_until, abandoned_at, paid_at, sent_to_carrier_at, delivered_at, cancelled_at,
  created_at, updated_at
) on public.orders to authenticated;
grant select (
  id, order_id, product_id, variant_id, sku, name_snapshot, variant_label, quantity,
  unit_price, unit_compare_at, line_discount, created_at, updated_at
) on public.order_items to authenticated;

-- El servidor (service_role) conserva acceso total
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
