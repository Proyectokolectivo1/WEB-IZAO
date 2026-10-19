-- M8 · Las páginas legales tienen estado de publicación: la tienda solo muestra `published`.
-- Todas las existentes quedan en `draft`: las de Ecuador se sembraron con texto colombiano y las de Colombia
-- conservan marcadores [COMPLETAR] / [RAZÓN SOCIAL] / [NIT] por resolver. Aditiva y reversible (drop column status).

alter table public.pages
  add column status text not null default 'draft' check (status in ('draft', 'published'));

comment on column public.pages.status is
  'draft = borrador (no se muestra en la tienda); published = visible. No publicar con marcadores [..] sin resolver.';

create index pages_country_status_idx on public.pages (country_code, status);

-- Por si algún borrador ya publicado en el panel tuviera marcadores: ninguna página con [..] sin resolver se publica.
create or replace function public.enforce_page_publish_markers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.content_html ~ '\[(COMPLETAR|RAZÓN SOCIAL|NIT|DIRECCIÓN[^\]]*|CORREO|TELÉFONO|NÚMERO|HORARIO|FECHA|URL|CONFIRMAR[^\]]*|VERIFICAR[^\]]*)\]' then
    raise exception 'La página % (%) tiene marcadores sin resolver y no se puede publicar', new.slug, new.country_code
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_page_publish_markers() from public, anon, authenticated;

create trigger enforce_page_publish_markers
  before insert or update of status, content_html on public.pages
  for each row execute function public.enforce_page_publish_markers();
