-- B-n5 · Refina la detección de marcadores sin resolver en páginas legales. Reglas:
--  * Marcador = corchetes cuyo contenido empieza por una palabra de 2 o más letras MAYÚSCULAS (con tildes y ñ), opcionalmente
--    seguida de espacio, ':' o ',' y más texto sin corchetes anidados: [COMPLETAR], [ID], [RAZÓN SOCIAL], [COMPLETAR: algo].
--  * No son marcadores: corchetes con cifras o minúsculas ([30], [$10.000], [2 a 4], [más detalles]), CDATA (`[CDATA[`)
--    ni las siglas legítimas de la lista corta COP, USD, IVA y UVT ([COP], [USD 100], [IVA incluido]).
--  * [NIT] SÍ es marcador (dato del dueño por completar).
-- El error nombra el primer marcador encontrado. Para permitir otra sigla hay que añadirla a la lista en una migración.
-- Aditiva y reversible (restaurar la función anterior).

create or replace function public.enforce_page_publish_markers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m text[];
begin
  if new.status = 'published' then
    for m in
      select x from regexp_matches(new.content_html, '(\[([A-ZÁÉÍÓÚÑ]{2,}[A-ZÁÉÍÓÚÑ0-9_]*)(?:[ :,][^\[\]]*)?\])', 'g') as x
    loop
      if m[2] <> all (array['COP', 'USD', 'IVA', 'UVT']) then
        raise exception 'La página % (%) tiene el marcador sin resolver % y no se puede publicar', new.slug, new.country_code, m[1]
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
