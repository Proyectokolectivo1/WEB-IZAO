-- Configuración de imágenes editable en el panel (calidad WebP, peso máximo de subida, etc.).
-- Aditiva: columna jsonb con default '{}' y check de que sea un objeto. El panel valida rangos
-- (calidad WebP 50–95, peso 1–25 MB); sin RLS nueva (site_settings ya tiene RLS activo).
alter table public.site_settings
  add column media_settings jsonb not null default '{}'::jsonb
  constraint site_settings_media_settings_objeto check (jsonb_typeof(media_settings) = 'object');

comment on column public.site_settings.media_settings is
  'Ajustes de imágenes editables en el panel (p. ej. calidad WebP 50–95, peso máximo 1–25 MB). Objeto JSON; vacío = valores por defecto del código.';
