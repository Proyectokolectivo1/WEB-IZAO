-- Pruebas pgtap · site_settings.media_settings: jsonb not null default '{}' y solo admite objetos JSON.
begin;
set local search_path = public, extensions;
select plan(7);

select has_column('public', 'site_settings', 'media_settings', 'site_settings tiene media_settings');
select col_type_is('public', 'site_settings', 'media_settings', 'jsonb', 'media_settings es jsonb');
select col_not_null('public', 'site_settings', 'media_settings', 'media_settings no admite null');
select col_default_is('public', 'site_settings', 'media_settings', '{}'::jsonb, 'por defecto objeto vacio');
select throws_ok($$update public.site_settings set media_settings = '[1,2]'::jsonb$$, '23514', null,
  'un arreglo JSON viola el check');
select throws_ok($$update public.site_settings set media_settings = '85'::jsonb$$, '23514', null,
  'un escalar JSON viola el check');
select lives_ok($$update public.site_settings set media_settings = '{"webp_quality": 82, "max_upload_mb": 10}'::jsonb$$,
  'un objeto JSON se guarda');

select * from finish();
rollback;
