-- Espacios de contenido (`content_slots`) que lee la tienda, sembrados por país (CO y EC).
-- Claves: `nota_envio` (cuerpo: nota bajo los totales), `valor_envio` (título: valor de la fila «Envío»),
-- `medios_de_pago` (imagen de logos; la sube el dueño), `asesoria` (imagen del bloque de asesoría; la sube el dueño),
-- `busquedas_populares` (cuerpo: una búsqueda por línea).
-- Idempotente: `on conflict do nothing` sobre (key, country_code); nunca pisa lo que el admin edite en el panel.
-- Solo siembra países que existan (en una base nueva, los países llegan con seed.sql, que repite este bloque).
-- Sin imágenes: media_id queda nulo hasta que el dueño cargue la suya (la tienda no muestra el espacio sin imagen).

insert into public.content_slots (key, country_code, title, body, is_active)
select v.key, c.code, v.title, v.body, true
  from (values
    ('nota_envio', 'CO', null, 'El envío es gratis a toda Colombia. El total final lo confirmamos al finalizar la compra.'),
    ('nota_envio', 'EC', null, 'El envío es gratis a todo Ecuador. El total final lo confirmamos al finalizar la compra.'),
    ('valor_envio', 'CO', 'Gratis', null),
    ('valor_envio', 'EC', 'Gratis', null),
    ('medios_de_pago', 'CO', 'Medios de pago', null),
    ('medios_de_pago', 'EC', 'Medios de pago', null),
    ('asesoria', 'CO', 'Asesoría personalizada', null),
    ('asesoria', 'EC', 'Asesoría personalizada', null),
    ('busquedas_populares', 'CO', null, E'Floral\nAmaderada\nCítrica\nGourmand\nFrutal\nAcuática'),
    ('busquedas_populares', 'EC', null, E'Floral\nAmaderada\nCítrica\nGourmand\nFrutal\nAcuática')
  ) as v(key, country_code, title, body)
  join public.countries c on c.code = v.country_code
on conflict (key, country_code) do nothing;
