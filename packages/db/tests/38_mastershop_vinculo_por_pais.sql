-- Pruebas pgtap · vínculo MasterShop por país (D-052): variant_countries.mastershop_*, espejo CO <-> product_variants,
-- regla sin_vinculo_mastershop para todo país con carrier_provider = 'mastershop', y RLS de variant_countries.
begin;
set local search_path = public, extensions;
select plan(20);

select has_column('public', 'variant_countries', 'mastershop_product_id', 'variant_countries tiene mastershop_product_id');
select has_column('public', 'variant_countries', 'mastershop_variant_id', 'variant_countries tiene mastershop_variant_id');
select col_type_is('public', 'variant_countries', 'mastershop_product_id', 'integer', 'mastershop_product_id es integer');
select col_type_is('public', 'variant_countries', 'mastershop_variant_id', 'integer', 'mastershop_variant_id es integer');

-- Ecuador despacha con MasterShop solo dentro de esta prueba.
update public.country_settings set carrier_provider = 'mastershop' where country_code = 'EC';

create temp table r38(k text primary key, j jsonb);

-- A: activo y visible en CO y EC; vínculo solo de CO (a nivel de variante, contrato anterior) -> falta EC
insert into r38 values ('sin_ec', public.admin_guardar_producto('{"product": {"name": "MS38 uno", "slug": "ms38-uno", "status": "active"},
  "countries": [{"country_code": "CO", "is_visible": true}, {"country_code": "EC", "is_visible": true}],
  "variants": [{"sku": "MS38-1", "is_default": true, "mastershop_product_id": 3801,
    "countries": [{"country_code": "CO", "is_active": true, "price": 1000}, {"country_code": "EC", "is_active": true, "price": 500}]}]}'));
select is((select (j ->> 'motivo') || '|' || (j ->> 'detalle') from r38 where k = 'sin_ec'), 'sin_vinculo_mastershop|MS38-1',
  'EC con carrier mastershop y sin vínculo de EC: sin_vinculo_mastershop con el sku');
select is((select j -> 'paises' from r38 where k = 'sin_ec'), '["EC"]'::jsonb, 'el error dice qué país falta');

-- B: con el vínculo propio de EC en countries[] -> se guarda; CO hereda el de la variante
insert into r38 values ('con_ec', public.admin_guardar_producto('{"product": {"name": "MS38 uno", "slug": "ms38-uno", "status": "active"},
  "countries": [{"country_code": "CO", "is_visible": true}, {"country_code": "EC", "is_visible": true}],
  "variants": [{"sku": "MS38-1", "is_default": true, "mastershop_product_id": 3801,
    "countries": [{"country_code": "CO", "is_active": true, "price": 1000},
                  {"country_code": "EC", "is_active": true, "price": 500, "mastershop_product_id": 9901, "mastershop_variant_id": 9902}]}]}'));
select is((select j ->> 'ok' from r38 where k = 'con_ec'), 'true', 'con vínculo de CO y de EC se publica');
select results_eq(
  $$ select vc.country_code, vc.mastershop_product_id, vc.mastershop_variant_id from public.variant_countries vc
       join public.product_variants pv on pv.id = vc.variant_id where pv.sku = 'MS38-1' order by 1 $$,
  $$ values ('CO'::text, 3801, null::int), ('EC'::text, 9901, 9902) $$,
  'cada país guarda su propio vínculo');
select is((select mastershop_product_id from public.product_variants where sku = 'MS38-1'), 3801,
  'el vínculo de EC no toca product_variants (espejo solo de CO)');

-- C: espejo CO -> product_variants
update public.variant_countries vc set mastershop_product_id = 3802
  from public.product_variants pv where pv.id = vc.variant_id and pv.sku = 'MS38-1' and vc.country_code = 'CO';
select is((select mastershop_product_id from public.product_variants where sku = 'MS38-1'), 3802,
  'cambiar el vínculo de CO actualiza product_variants');

-- D: espejo product_variants -> CO (escritores anteriores); EC no cambia
update public.product_variants set mastershop_product_id = 3803, mastershop_variant_id = 5 where sku = 'MS38-1';
select results_eq(
  $$ select vc.country_code, vc.mastershop_product_id, vc.mastershop_variant_id from public.variant_countries vc
       join public.product_variants pv on pv.id = vc.variant_id where pv.sku = 'MS38-1' order by 1 $$,
  $$ values ('CO'::text, 3803, 5), ('EC'::text, 9901, 9902) $$,
  'cambiar product_variants actualiza solo la fila de CO');

-- E: CO sin vínculo y EC con vínculo -> falta CO
insert into r38 values ('sin_co', public.admin_guardar_producto('{"product": {"name": "MS38 dos", "slug": "ms38-dos", "status": "active"},
  "countries": [{"country_code": "CO", "is_visible": true}, {"country_code": "EC", "is_visible": true}],
  "variants": [{"sku": "MS38-2", "is_default": true,
    "countries": [{"country_code": "CO", "is_active": true, "price": 1000},
                  {"country_code": "EC", "is_active": true, "price": 500, "mastershop_product_id": 9911}]}]}'));
select is((select j -> 'paises' from r38 where k = 'sin_co'), '["CO"]'::jsonb, 'sin vínculo de CO: paises = [CO]');

-- F: Ecuador sin transportadora -> no exige vínculo en EC; el vínculo de CO en countries[] llega al espejo
update public.country_settings set carrier_provider = null where country_code = 'EC';
insert into r38 values ('ec_sin_carrier', public.admin_guardar_producto('{"product": {"name": "MS38 tres", "slug": "ms38-tres", "status": "active"},
  "countries": [{"country_code": "CO", "is_visible": true}, {"country_code": "EC", "is_visible": true}],
  "variants": [{"sku": "MS38-3", "is_default": true,
    "countries": [{"country_code": "CO", "is_active": true, "price": 1000, "mastershop_product_id": 3810},
                  {"country_code": "EC", "is_active": true, "price": 500}]}]}'));
select is((select j ->> 'ok' from r38 where k = 'ec_sin_carrier'), 'true', 'país sin carrier_provider no exige vínculo');
select is((select mastershop_product_id from public.product_variants where sku = 'MS38-3'), 3810,
  'el vínculo de CO enviado por país llega a product_variants');
update public.country_settings set carrier_provider = 'mastershop' where country_code = 'EC';

-- G: null explícito en countries[] borra el vínculo de CO (borrador: se puede guardar sin vínculo)
select public.admin_guardar_producto('{"product": {"id": "38000000-0000-0000-0000-000000000001", "name": "MS38 cuatro", "slug": "ms38-cuatro", "status": "draft"},
  "variants": [{"sku": "MS38-4", "is_default": true, "countries": [{"country_code": "CO", "price": 1000, "mastershop_product_id": 3820}]}]}');
insert into r38 values ('borrar', public.admin_guardar_producto('{"product": {"id": "38000000-0000-0000-0000-000000000001", "name": "MS38 cuatro", "slug": "ms38-cuatro", "status": "draft"},
  "variants": [{"sku": "MS38-4", "is_default": true, "countries": [{"country_code": "CO", "price": 1000, "mastershop_product_id": null}]}]}'));
select results_eq(
  $$ select (select j ->> 'ok' from r38 where k = 'borrar'), vc.mastershop_product_id, pv.mastershop_product_id
       from public.variant_countries vc join public.product_variants pv on pv.id = vc.variant_id
      where pv.sku = 'MS38-4' and vc.country_code = 'CO' $$,
  $$ values ('true'::text, null::int, null::int) $$,
  'null explícito borra el vínculo de CO y su espejo');

-- H: importación con EC sin vínculo -> error con paises
insert into r38 values ('importar', public.admin_importar_catalogo('{"modo": "simular", "filas": [{"product": {"name": "MS38 cinco", "slug": "ms38-cinco", "status": "active"},
  "countries": [{"country_code": "EC", "is_visible": true}],
  "variants": [{"sku": "MS38-5", "is_default": true, "countries": [{"country_code": "EC", "is_active": true, "price": 500}]}]}]}'));
select is((select j -> 'errores' -> 0 ->> 'motivo' from r38 where k = 'importar'), 'sin_vinculo_mastershop', 'la importación aplica la regla en EC');
select is((select j -> 'errores' -> 0 -> 'paises' from r38 where k = 'importar'), '["EC"]'::jsonb, 'el error de importación trae paises');
select is((select jsonb_array_length(j -> 'errores') from r38 where k = 'importar'), 1, 'paises va dentro del error, no como elemento aparte');

-- RLS / privilegios: variant_countries (con el vínculo) no se lee desde el navegador
set local role anon;
select throws_ok($$ select mastershop_product_id from public.variant_countries limit 1 $$, '42501', null,
  'anon no lee variant_countries');
reset role;
set local role authenticated;
select throws_ok($$ select mastershop_product_id from public.variant_countries limit 1 $$, '42501', null,
  'authenticated no lee variant_countries');
reset role;

select * from finish();
rollback;
