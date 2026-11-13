-- Botón flotante de WhatsApp «Hablar con un asesor» (por país). Aditiva: no borra ni renombra nada.
--
-- Contrato
--   country_settings.advisor_whatsapp (ya existía; lo usan Iza, el pie y los avisos) = número del asesor del país, solo
--     dígitos con código de país (CO 57…, EC 593…). Un solo dato por país: el botón flotante lo reutiliza.
--     Se normaliza aquí lo que ya hubiera (quita «+», espacios y guiones; lo que no quede en 8-15 dígitos pasa a null,
--     porque la tienda ya lo ignoraba) y se añade un check para que el panel nunca guarde otra cosa.
--   country_settings.advisor_whatsapp_message = mensaje que llega prellenado en el chat. null = texto por defecto de la tienda.
--   country_settings.advisor_whatsapp_button_enabled = apaga o enciende el botón flotante de ese país sin borrar el número
--     (el número sigue sirviendo a Iza y al pie). Sin número, el botón no se muestra aunque esté encendido.
--
-- Reversión: alter table public.country_settings drop constraint country_settings_advisor_whatsapp_digits,
--   drop constraint country_settings_advisor_whatsapp_message_len, drop column advisor_whatsapp_message,
--   drop column advisor_whatsapp_button_enabled;

update public.country_settings
   set advisor_whatsapp = nullif(regexp_replace(advisor_whatsapp, '\D', '', 'g'), '')
 where advisor_whatsapp is not null and advisor_whatsapp !~ '^[0-9]+$';

update public.country_settings
   set advisor_whatsapp = null
 where advisor_whatsapp is not null and advisor_whatsapp !~ '^[0-9]{8,15}$';

alter table public.country_settings
  add column advisor_whatsapp_message text,
  add column advisor_whatsapp_button_enabled boolean not null default true,
  add constraint country_settings_advisor_whatsapp_digits
    check (advisor_whatsapp is null or advisor_whatsapp ~ '^[0-9]{8,15}$'),
  add constraint country_settings_advisor_whatsapp_message_len
    check (advisor_whatsapp_message is null or char_length(advisor_whatsapp_message) between 1 and 300);

comment on column public.country_settings.advisor_whatsapp is 'WhatsApp del asesor del país: solo dígitos con código de país (57…, 593…). Lo usan el botón flotante, Iza y el pie.';
comment on column public.country_settings.advisor_whatsapp_message is 'Mensaje prellenado del botón de WhatsApp. null = el texto por defecto de la tienda.';
comment on column public.country_settings.advisor_whatsapp_button_enabled is 'Muestra el botón flotante de WhatsApp en la tienda de ese país (además exige advisor_whatsapp).';

-- Valor por defecto del seed (editable en el panel): sin afirmar originalidad ni afiliaciones.
update public.country_settings
   set advisor_whatsapp_message = 'Hola, quiero que me ayuden a elegir una fragancia.'
 where advisor_whatsapp_message is null;
