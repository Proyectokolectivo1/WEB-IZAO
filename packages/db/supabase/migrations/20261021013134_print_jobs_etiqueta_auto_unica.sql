-- Una sola impresión automática de etiqueta por envío (cierra la carrera poll_label / sync, §15.x "no se imprime dos
-- veces automáticamente"). Las reimpresiones manuales (requested_by 'admin:…') y los trabajos cancelados no cuentan.
create unique index print_jobs_etiqueta_auto_unica_key
  on public.print_jobs (shipment_id)
  where type = 'label' and requested_by = 'auto' and status <> 'cancelled';

comment on index public.print_jobs_etiqueta_auto_unica_key is
  'Una etiqueta automática (requested_by = auto, no cancelada) por envío. Insertar otra → 23505 (tratar como ya existente).';
