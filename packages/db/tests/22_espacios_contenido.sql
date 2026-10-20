-- Pruebas pgtap · espacios de contenido que lee la tienda (migración 20261020220958 y seed.sql, Parte 3).
-- Supone la base con migraciones y seed aplicados (países CO y EC).
begin;
set local search_path = public, extensions;
select plan(12);

select is((select count(*)::int from public.content_slots
            where country_code in ('CO', 'EC')
              and key in ('nota_envio', 'valor_envio', 'medios_de_pago', 'asesoria', 'busquedas_populares')),
  10, 'cinco claves sembradas por país (CO y EC)');

select is((select count(*)::int from public.content_slots
            where country_code is null
              and key in ('nota_envio', 'valor_envio', 'medios_de_pago', 'asesoria', 'busquedas_populares')),
  0, 'ningún espacio global: todo es por país');

select ok((select bool_and(nullif(btrim(title), '') is not null) from public.content_slots where key = 'valor_envio'),
  'valor_envio trae el valor mostrado en el título');

select ok((select bool_and(nullif(btrim(body), '') is not null) from public.content_slots where key = 'nota_envio'),
  'nota_envio trae la nota en el cuerpo');

select ok((select body like '%Colombia%' from public.content_slots where key = 'nota_envio' and country_code = 'CO')
      and (select body like '%Ecuador%' from public.content_slots where key = 'nota_envio' and country_code = 'EC'),
  'la nota de envío nombra el país correcto');

select ok((select bool_and(array_length(regexp_split_to_array(btrim(body), '\s*[\n,]\s*'), 1) between 3 and 8)
             from public.content_slots where key = 'busquedas_populares'),
  'busquedas_populares trae entre 3 y 8 búsquedas');

select ok((select bool_and(media_id is null and mobile_media_id is null)
             from public.content_slots where key in ('medios_de_pago', 'asesoria')),
  'medios_de_pago y asesoria sin imagen inventada (la sube el dueño)');

select is((select count(*)::int from public.content_slots
            where key in ('nota_envio', 'valor_envio', 'medios_de_pago', 'asesoria', 'busquedas_populares')
              and (coalesce(title, '') || ' ' || coalesce(body, '')) ~* '(original|aut[eé]ntic|certificad|r[eé]plica|\[[^\]]*\])'),
  0, 'sin afirmaciones de originalidad ni marcadores sin resolver');

select ok((select bool_and(is_active) from public.content_slots
            where key in ('nota_envio', 'valor_envio', 'medios_de_pago', 'asesoria', 'busquedas_populares')),
  'los espacios sembrados quedan activos');

-- Idempotencia: repetir el bloque no duplica ni pisa lo que edite el admin.
update public.content_slots set title = 'Desde $15.000' where key = 'valor_envio' and country_code = 'CO';
insert into public.content_slots (key, country_code, title, body, is_active)
select v.key, c.code, v.title, v.body, true
  from (values ('valor_envio', 'CO', 'Gratis', null::text), ('nota_envio', 'CO', null, 'x')) as v(key, country_code, title, body)
  join public.countries c on c.code = v.country_code
on conflict (key, country_code) do nothing;
select is((select title from public.content_slots where key = 'valor_envio' and country_code = 'CO'),
  'Desde $15.000', 'repetir la siembra no pisa la edición del panel');
select is((select count(*)::int from public.content_slots where key = 'nota_envio' and country_code = 'CO'),
  1, 'repetir la siembra no duplica');

-- RLS y privilegios: anon no lee content_slots directamente (la tienda lee con la llave secreta).
set local role anon;
select throws_ok('select count(*) from public.content_slots', '42501', null, 'anon no lee content_slots');
reset role;

select * from finish();
rollback;
