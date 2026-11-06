-- Pruebas pgtap · banners.focal_x / focal_y (D-047): smallint not null default 50, rango 0–100.
begin;
set local search_path = public, extensions;
select plan(12);

select has_column('public', 'banners', 'focal_x', 'banners tiene focal_x');
select has_column('public', 'banners', 'focal_y', 'banners tiene focal_y');
select col_type_is('public', 'banners', 'focal_x', 'smallint', 'focal_x es smallint');
select col_type_is('public', 'banners', 'focal_y', 'smallint', 'focal_y es smallint');
select col_not_null('public', 'banners', 'focal_x', 'focal_x no admite null');
select col_not_null('public', 'banners', 'focal_y', 'focal_y no admite null');

insert into public.media (id, kind, base_path) values
  ('36000000-0000-0000-0000-000000000001', 'banner', 'banners/pgtap-36');
insert into public.banners (id, country_code, placement, desktop_media_id, mobile_media_id, alt) values
  ('36000000-0000-0000-0000-000000000002', 'CO', 'hero',
   '36000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', 'pgtap 36');

select results_eq(
  $$ select focal_x::int, focal_y::int from public.banners where id = '36000000-0000-0000-0000-000000000002' $$,
  $$ values (50, 50) $$,
  'un banner sin punto focal queda en 50/50');
select lives_ok(
  $$ update public.banners set focal_x = 0, focal_y = 100 where id = '36000000-0000-0000-0000-000000000002' $$,
  'los extremos 0 y 100 se aceptan');
select throws_ok(
  $$ update public.banners set focal_x = 101 where id = '36000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'focal_x 101 viola el check');
select throws_ok(
  $$ update public.banners set focal_x = -1 where id = '36000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'focal_x -1 viola el check');
select throws_ok(
  $$ update public.banners set focal_y = 101 where id = '36000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'focal_y 101 viola el check');
select throws_ok(
  $$ update public.banners set focal_y = null where id = '36000000-0000-0000-0000-000000000002' $$,
  '23502', null, 'focal_y null viola not null');

select * from finish();
rollback;
