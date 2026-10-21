-- Tope de reenvíos manuales del cobro del abono ("Reenviar cobro") por país. Editable en el panel.
alter table public.country_settings
  add column cod_resend_max integer not null default 2
  constraint country_settings_cod_resend_max_check check (cod_resend_max >= 0);

comment on column public.country_settings.cod_resend_max is
  'Máximo de reenvíos manuales del cobro del abono (cod.reenviar) por pedido. 0 = no se permite reenviar.';
