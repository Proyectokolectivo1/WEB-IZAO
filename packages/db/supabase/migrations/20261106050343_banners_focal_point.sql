-- Punto focal del banner de una sola imagen (D-047): object-position {focal_x}% {focal_y}% al recortar.
-- Aditiva y autorizada por el dueño: dos smallint 0–100 con default 50 (centro); las filas existentes
-- quedan en 50/50. Sin RLS nueva (banners ya tiene RLS activo).
alter table public.banners
  add column focal_x smallint not null default 50 constraint banners_focal_x_rango check (focal_x between 0 and 100),
  add column focal_y smallint not null default 50 constraint banners_focal_y_rango check (focal_y between 0 and 100);

comment on column public.banners.focal_x is 'Punto focal horizontal en % (0 izquierda, 100 derecha) para object-position al recortar (D-047).';
comment on column public.banners.focal_y is 'Punto focal vertical en % (0 arriba, 100 abajo) para object-position al recortar (D-047).';
