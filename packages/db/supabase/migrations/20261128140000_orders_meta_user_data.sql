-- Datos del navegador para la API de Conversiones de Meta (calidad de coincidencia del Purchase).
--
-- `fbp`, `fbc`, IP y user-agent del comprador se guardan SOLO si aceptó cookies de marketing al comprar
-- (`marketing_consent`). Los escribe el servidor del checkout (llave de servicio) justo después de crear el pedido y los lee
-- el worker al enviar el Purchase. Nunca los lee el navegador. Aditiva; no toca `crear_pedido_checkout`.
-- Reversión: alter table public.orders drop column if exists meta_user_data;

alter table public.orders add column meta_user_data jsonb;
comment on column public.orders.meta_user_data is
  'Solo con marketing_consent: {fbp, fbc, ip, ua} del navegador al comprar, para la API de Conversiones de Meta. Lo escribe el servidor del checkout.';

revoke select (meta_user_data), insert (meta_user_data), update (meta_user_data) on public.orders from anon, authenticated;
