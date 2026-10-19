-- Pruebas pgtap · privilegios (M7, D-011): anon sin ningún privilegio y cliente autenticado con exactamente lo previsto.
begin;
set local search_path = public, extensions;
select plan(8);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
        or has_table_privilege('anon', c.oid, 'delete,truncate,trigger'))),
  0, 'anon no tiene ningun privilegio sobre tablas ni vistas de public');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege('anon', c.oid, 'usage,select,update')
        or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))),
  0, 'ni anon ni authenticated tienen privilegios sobre secuencias');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'ni anon ni authenticated ejecutan funciones de public');

-- authenticated: exactamente lo de D-011
select is(
  (select array_agg(c.relname || ':' || p.priv order by c.relname, p.priv)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p(priv)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and case when p.priv in ('select', 'insert', 'update')
            then has_any_column_privilege('authenticated', c.oid, p.priv)
            else has_table_privilege('authenticated', c.oid, p.priv) end),
  array['addresses:select', 'customers:select', 'customers:update', 'order_items:select', 'orders:select', 'wishlists:select'],
  'authenticated solo conserva select/update de las tablas del cliente');

select is(
  (select array_agg(a.attname::text order by a.attname) from pg_attribute a
    where a.attrelid = 'public.customers'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')),
  array['document_number', 'document_type', 'first_name', 'last_name', 'marketing_opt_in', 'phone_e164', 'whatsapp_opt_in'],
  'authenticated solo actualiza las columnas de perfil de customers');

select is(
  (select count(*)::int from pg_attribute a
    where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname in ('notes_internal', 'click_ids', 'utm', 'gateway_fee_estimated', 'product_cost_total',
        'carrier_fees', 'shipping_cost_real', 'alerts', 'checkout_idempotency_key', 'influencer_id', 'discount_code_id')
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')),
  0, 'authenticated no lee columnas internas del pedido');

select is(
  (select count(*)::int from pg_default_acl d
    where d.defaclrole = 'postgres'::regrole and d.defaclobjtype in ('r', 'S', 'f')
      and d.defaclnamespace in (0, 'public'::regnamespace)
      and (d.defaclacl::text like '%anon=%' or d.defaclacl::text like '%authenticated=%')),
  0, 'los privilegios por defecto futuros de postgres no incluyen anon ni authenticated');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not has_table_privilege('service_role', c.oid, 'select,insert,update,delete')),
  0, 'service_role conserva acceso total a todas las tablas');

select * from finish();
rollback;
