-- Datos de la prueba: 10 pedidos que piden la última unidad de la variante V y 10 pedidos con el mismo código (límite total 3).
insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0');
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix) values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57');
insert into public.country_settings (country_code) values ('CO') on conflict do nothing;
insert into public.products (id, name, slug, status) values ('a0000000-0000-0000-0000-000000000001', 'Concurrencia', 'concurrencia', 'active');
insert into public.product_variants (id, product_id, sku, is_default) values ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'CC-1', true);
insert into public.variant_countries (variant_id, country_code, is_active, price, stock) values ('f0000000-0000-0000-0000-000000000001', 'CO', true, 100000, 1);
insert into public.discount_codes (id, code, country_code, type, value, usage_limit_total) values ('c0000000-0000-0000-0000-000000000001', 'CONCURRENCIA', 'CO', 'percent', 10, 3);

insert into public.orders (id, country_code, currency_code, contact_first_name, contact_last_name, contact_phone_e164, contact_email, document_number,
  payment_method, status, subtotal, total_customer, discount_code_id, discount_amount)
select ('d0000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'CO', 'COP', 'A', 'B', '+57300000' || lpad(g::text, 4, '0'),
       'c' || g || '@test.local', '9' || lpad(g::text, 9, '0'), 'wompi', 'pendiente_pago', 100000, 90000, 'c0000000-0000-0000-0000-000000000001', 10000
  from generate_series(1, 10) g;
insert into public.order_items (order_id, variant_id, sku, name_snapshot, quantity, unit_price)
select id, 'f0000000-0000-0000-0000-000000000001', 'CC-1', 'Concurrencia', 1, 100000 from public.orders;
