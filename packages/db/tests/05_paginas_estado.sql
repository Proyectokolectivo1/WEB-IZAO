-- Pruebas pgtap · estado de publicación de páginas legales (M8).
begin;
set local search_path = public, extensions;
select plan(6);

select has_column('public', 'pages', 'status', 'pages tiene la columna status');
select col_default_is('public', 'pages', 'status', 'draft', 'status por defecto: draft');
select is((select count(*)::int from public.pages where country_code = 'EC' and status <> 'draft'), 0,
  'las paginas de Ecuador (texto colombiano) no estan publicadas');

insert into public.currencies (code, exponent, symbol, format_pattern)
  values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.pages (country_code, slug, title, content_html)
  values ('CO', 'prueba-publicacion', 'Prueba', '<p>Escribe a [CORREO] o llama al [TELÉFONO].</p>');

select throws_ok($$update public.pages set status = 'published' where slug = 'prueba-publicacion'$$, '23514', null,
  'no se publica una pagina con marcadores sin resolver');
update public.pages set content_html = '<p>Escribe a hola@example.com.</p>' where slug = 'prueba-publicacion';
select lives_ok($$update public.pages set status = 'published' where slug = 'prueba-publicacion'$$,
  'se publica una pagina con los marcadores resueltos');
select throws_ok($$insert into public.pages (country_code, slug, title, status) values ('CO', 'otra', 'Otra', 'oculto')$$,
  '23514', null, 'status solo admite draft o published');

select * from finish();
rollback;
