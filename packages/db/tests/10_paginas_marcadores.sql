-- Pruebas pgtap · B-5: el trigger de publicación de páginas detecta cualquier marcador [MAYÚSCULAS ...], no una lista cerrada.
begin;
set local search_path = public, extensions;
select plan(12);

insert into public.currencies (code, exponent, symbol, format_pattern)
  values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;
insert into public.pages (id, country_code, slug, title, content_html)
  values ('a0000000-0000-0000-0000-0000000000c1', 'CO', 'prueba-marcadores', 'Prueba', '<p>x</p>');

-- Marcadores conocidos y nuevos: bloquean la publicacion
select throws_ok(format($$update public.pages set content_html = %L, status = 'published' where id = 'a0000000-0000-0000-0000-0000000000c1'$$, t.html),
  '23514', null, 'bloquea ' || t.etiqueta)
from (values
  ('[COMPLETAR]', '<p>[COMPLETAR]</p>'),
  ('[RAZÓN SOCIAL]', '<p>[RAZÓN SOCIAL], NIT [NIT]</p>'),
  ('[COMPLETAR: algo]', '<p>Horario [COMPLETAR: lunes a viernes]</p>'),
  ('[DIRECCIÓN, CIUDAD]', '<p>[DIRECCIÓN, CIUDAD]</p>'),
  ('[CONFIRMAR decisión del negocio]', '<p>[CONFIRMAR decisión del negocio]</p>'),
  ('[VERIFICAR con abogado]', '<p>[VERIFICAR con abogado]</p>'),
  ('[PRECIO POR DEFINIR] (nuevo)', '<p>Costo: [PRECIO POR DEFINIR]</p>'),
  ('[TELÉFONO] (nuevo)', '<p>Llama al [TELÉFONO]</p>')
) as t(etiqueta, html);

-- Corchetes legitimos: no son marcadores
select lives_ok($$update public.pages set content_html = '<p>Plazo de [30] dias, abono de [$10.000], entrega en [2 a 4] dias, antes de las [2:00 p. m.], cargo del [10 %].</p><p>Ver [más detalles]</p>', status = 'published' where id = 'a0000000-0000-0000-0000-0000000000c1'$$,
  'no hay falsos positivos con cifras ni texto en minusculas entre corchetes');
select is((select status from public.pages where id = 'a0000000-0000-0000-0000-0000000000c1'), 'published', 'la pagina quedo publicada');
select lives_ok($$update public.pages set content_html = '<p>Texto final sin marcadores.</p>' where id = 'a0000000-0000-0000-0000-0000000000c1'$$,
  'editar una pagina publicada sin marcadores es valido');

-- El seed de prueba: los marcadores que contiene son los esperados y por eso nada esta publicado
select is((select count(*)::int from public.pages where status = 'published' and slug <> 'prueba-marcadores'), 0,
  'ninguna pagina sembrada esta publicada');

select * from finish();
rollback;
