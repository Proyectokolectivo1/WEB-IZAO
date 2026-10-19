-- B-5 · El trigger de publicación de páginas detecta cualquier marcador [MAYÚSCULAS ...] (p. ej. [COMPLETAR: algo],
-- [PRECIO POR DEFINIR]), no una lista cerrada. No bloquea corchetes con cifras o minúsculas ([30], [$10.000], [2 a 4]).
-- Aditiva y reversible (restaurar la función anterior).

create or replace function public.enforce_page_publish_markers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.content_html ~ '\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{2,}[^\]]*\]' then
    raise exception 'La página % (%) tiene marcadores sin resolver y no se puede publicar', new.slug, new.country_code
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
