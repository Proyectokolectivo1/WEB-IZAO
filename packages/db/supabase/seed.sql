-- seed.sql · Seed base idempotente de Izao Perfumería (§6.2, §8.1, §8.5, §11.2, §19, Anexos A y B, D-012)
--
-- Idempotente: usa `on conflict do nothing` / `where not exists`, así que una segunda corrida no cambia
-- nada y nunca pisa lo que el admin edite en el panel.
-- No inventa datos del dueño: los marcadores [COMPLETAR], [RAZÓN SOCIAL], [NIT], etc. se copian tal cual.
-- Regiones, ciudades, taxonomías y productos de prueba NO van aquí: los carga
-- `node packages/db/seed/build-data-sql.mjs` a partir de packages/db/seed/data/ (ver FORMATO.md).

-- ---------------------------------------------------------------------------
-- Parte 1: referencia y configuración
-- ---------------------------------------------------------------------------
begin;

insert into public.currencies (code, exponent, symbol, format_pattern) values
  ('COP', 0, '$', '$ #.##0'),
  ('USD', 2, '$', '$ #.##0,00')
on conflict (code) do nothing;

insert into public.countries (code, name, currency_code, locale, timezone, is_active, phone_prefix) values
  ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', true, '+57'),
  ('EC', 'Ecuador', 'USD', 'es-EC', 'America/Guayaquil', true, '+593')
on conflict (code) do nothing;

-- §6.2 / §11.2. Ecuador: abono, recaudo mínimo y TRM = [COMPLETAR] por el dueño.
insert into public.country_settings (
  country_code, cod_enabled, cod_deposit_amount, cod_min_collect_amount, cod_link_ttl_hours,
  cod_reminder_offsets_minutes, cod_quiet_hours_start, cod_quiet_hours_end, financing_surcharge_pct,
  pending_payment_ttl_minutes, manual_order_ttl_hours, advisor_whatsapp, support_email,
  announcement_rotation_seconds, fx_rate_to_cop, carrier_provider, carrier_auto_confirm,
  carrier_discount_mode, shipping_cost_estimate, hide_out_of_stock)
values
  ('CO', true, 10000, 20000, 24, '{180,720,1260}', '21:00', '07:00', '{"addi":10,"sistecredito":10}',
   60, 24, null, null, 4, 1, 'mastershop', true, 'prorate', 0, false),
  ('EC', false, 0, 0, 24, '{180,720,1260}', '21:00', '07:00', '{}',
   60, 24, null, null, 4, null, null, true, 'prorate', 0, false)
on conflict (country_code) do nothing;

-- Métodos de pago: desactivados hasta cargar credenciales. Comisión Wompi = referencia §12.2 (a confirmar con el contrato).
insert into public.payment_method_settings (country_code, method, is_enabled, sort_order, display_name, description, fee_pct, fee_fixed, fee_tax_pct) values
  ('CO', 'wompi', false, 1, 'Wompi', 'Paga en línea con Wompi.', 2.65, 700, 19),
  ('CO', 'addi', false, 2, 'Addi', 'Paga a cuotas con Addi. Incluye un cargo por financiación.', 0, 0, 0),
  ('CO', 'sistecredito', false, 3, 'Sistecrédito', 'Paga a cuotas con Sistecrédito. Incluye un cargo por financiación.', 0, 0, 0),
  ('CO', 'cod', false, 4, 'Contra entrega', 'Haz un abono por WhatsApp y paga el resto al recibir.', 0, 0, 0)
on conflict (country_code, method) do nothing;

-- §8.1 paleta y §8.2 pareja tipográfica por defecto
insert into public.site_settings (id, store_name, color_tokens, typography, social_links, legal_info) values (
  true,
  'Izao Perfumería',
  '{"color-bg":"#FDFBF7","color-surface":"#EADCC9","color-accent":"#CBA8A8","color-muted":"#8E7564","color-ink":"#382E2B","color-line":"rgba(56, 46, 43, 0.12)","color-success":"#5E7A5A","color-danger":"#A4483B","color-ink-hover":"#4A3D39"}',
  '{"pair":1,"heading_font":"Cormorant Garamond","body_font":"Manrope","base_size_px":16,"label_letter_spacing":"0.14em"}',
  '{}',
  '{"razon_social":"[RAZÓN SOCIAL]","nit":"[NIT]","direccion":"[DIRECCIÓN, CIUDAD]","correo":"[CORREO]","telefono":"[TELÉFONO]","whatsapp":"[NÚMERO]","horario":"[HORARIO]"}'
) on conflict (id) do nothing;

insert into public.chat_settings (id) values (true) on conflict (id) do nothing;

insert into public.expense_categories (slug, name, is_system) values
  ('pauta_meta', 'Pauta Meta', true),
  ('pauta_tiktok', 'Pauta TikTok', false),
  ('empaque', 'Empaque', false),
  ('nomina', 'Nómina', false),
  ('software', 'Software', false),
  ('mastershop', 'MasterShop', true),
  ('otros', 'Otros', true)
on conflict (slug) do nothing;

-- §19 + Anexo A.4
insert into public.warranty_settings (country_code, period_days, response_days, reasons, instructions_html, conditions_html)
select c.code, 30, 5,
  array['Atomizador o válvula defectuosa', 'Fuga o envase roto al recibirlo',
        'Producto distinto al que pediste o faltante en el paquete',
        'Daños de transporte reportados en las primeras 24 horas'],
  '<p>Diligencia el formulario con tu número de pedido, el celular con el que compraste, el motivo y fotos o video del producto y su empaque. Recibirás un número de caso y te responderemos en máximo [5] días hábiles.</p>',
  '<p>Durante los <strong>[30] días</strong> siguientes a la entrega, respondemos si tu producto presenta: atomizador o válvula defectuosa; fuga o envase roto al recibirlo; producto distinto al que pediste o faltante en el paquete; daños de transporte reportados en las primeras 24 horas.</p><p><strong>No cubre:</strong> preferencias personales sobre el aroma después de abierto el producto, reacciones de sensibilidad en la piel (te recomendamos probar primero en una pequeña zona), uso inadecuado, exposición prolongada al calor o al sol, ni diferencias de duración o proyección que dependen del tipo de piel y del clima.</p>'
from public.countries c
on conflict (country_code) do nothing;

-- §8.5 orden por defecto del home
insert into public.home_sections (country_code, type, config, sort_order, is_active)
select c.code, s.type, '{}'::jsonb, s.ord, true
from public.countries c
cross join (values ('hero',1), ('categories',2), ('families',3), ('banner',4), ('collection_tabs',5),
                   ('advice',6), ('benefits',7), ('reviews',8)) as s(type, ord)
where not exists (select 1 from public.home_sections h where h.country_code = c.code);

-- §8.5 barra de anuncios
insert into public.announcements (country_code, text, sort_order, is_active)
select a.country_code, a.text, a.ord, true
from (values
  ('CO', 'Descuentos de hasta el 30 %', 1),
  ('CO', 'Envío gratis a toda Colombia', 2),
  ('CO', 'Paga contra entrega', 3),
  ('EC', 'Descuentos de hasta el 30 %', 1),
  ('EC', 'Envío gratis a todo Ecuador', 2)
) as a(country_code, text, ord)
where not exists (select 1 from public.announcements x where x.country_code = a.country_code);

-- §8.5 tabs de colecciones (por regla)
insert into public.collections (country_code, name, slug, type, rule, sort_order, show_in_home_tabs, is_active)
select c.code, x.name, x.slug, 'rule', x.rule::jsonb, x.ord, true, true
from public.countries c
cross join (values
  ('Hot Sale', 'hot-sale', '{"badge":"hot_sale"}', 1),
  ('Nuevo', 'nuevo', '{"new_days":30}', 2),
  ('Combos', 'combos', '{"badge":"combo"}', 3),
  ('Más vendidos', 'mas-vendidos', '{"best_sellers_days":30}', 4)
) as x(name, slug, rule, ord)
on conflict (country_code, slug) do nothing;

-- Anexo B · plantillas de WhatsApp (Colombia; contra entrega solo existe en CO). Inactivas hasta aprobación de Meta.
insert into public.whatsapp_templates (key, country_code, meta_template_name, category, language, body_text, footer_text, button_text, button_url, variables_map, meta_status, version, is_active)
select t.key, 'CO', t.key, 'UTILITY', 'es', t.body, 'Izao Perfumería', 'Pagar abono',
  'https://izaoperfumeria.com/pagar/{{1}}',
  '{"1":"customer_first_name","2":"order_number","3":"cod_deposit_amount","4":"cod_collect_amount","5":"pay_link_expires_at","button_url_1":"pay_link_token"}'::jsonb,
  'draft', 1, false
from (values
  ('cobro_abono', E'Hola, {{1}}. Recibimos tu pedido {{2}} en Izao Perfumería.\nPara confirmarlo y despacharlo con pago contra entrega, realiza el abono de {{3}} en el botón de abajo. Al recibir tu pedido pagas {{4}}.\nEl link de pago está disponible hasta el {{5}}.'),
  ('recordatorio_abono_1', E'Hola, {{1}}. Tu pedido {{2}} sigue reservado para ti.\nSolo falta el abono de {{3}} para despacharlo; al recibir pagas {{4}}. Disponible hasta el {{5}}.'),
  ('recordatorio_abono_2', E'{{1}}, te recordamos que tu pedido {{2}} está pendiente del abono de {{3}}.\nEn cuanto lo recibamos, lo despachamos. Al recibir pagas {{4}}. Link disponible hasta el {{5}}.'),
  ('recordatorio_abono_final', E'{{1}}, tu pedido {{2}} se libera el {{5}} si no recibimos el abono de {{3}}.\nSi aún lo quieres, hazlo desde el botón y lo despachamos de inmediato.')
) as t(key, body)
on conflict (key, country_code, version) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Parte 2: páginas legales (Anexo A, borradores para revisión de abogado). Marcadores copiados tal cual.
-- ---------------------------------------------------------------------------
begin;

-- Estado de publicación (M8): todas las páginas se siembran en `draft` (default de la columna): las de Colombia tienen
-- marcadores [COMPLETAR]/[RAZÓN SOCIAL]/[NIT] por resolver y las de Ecuador parten de texto colombiano. El panel las publica.
insert into public.pages (country_code, slug, title, content_html, version) values
('CO', 'quienes-somos', 'Quiénes somos', '<p>[COMPLETAR]</p>', 1),

('CO', 'politica-de-envios', 'Política de envíos', $html$<p><strong>1. Cobertura.</strong> Enviamos a todo el territorio colombiano donde tenga cobertura nuestra transportadora aliada. En algunas zonas el pago contra entrega puede no estar disponible; si es tu caso, te lo indicamos antes de confirmar el pedido.</p>
<p><strong>2. Costo.</strong> El envío es <strong>gratis</strong> en todos los pedidos.</p>
<p><strong>3. Tiempos de entrega.</strong> Contados en días hábiles desde la confirmación del pago o del abono:</p>
<ul>
<li>Ciudades principales: [2 a 4] días hábiles.</li>
<li>Otras ciudades y municipios: [3 a 7] días hábiles.</li>
<li>Zonas rurales o de difícil acceso: hasta [10] días hábiles.</li>
</ul>
<p>Los pedidos confirmados antes de las [2:00 p. m.] de un día hábil se despachan ese mismo día. Los tiempos pueden variar por situaciones ajenas a nosotros (clima, orden público, temporadas de alta demanda).</p>
<p><strong>4. Pago contra entrega.</strong> Para confirmar un pedido contra entrega te enviamos por WhatsApp un link para realizar un abono de [$10.000]. Ese valor se descuenta del total y el saldo lo pagas al recibir. El link está disponible durante 24 horas; si no se realiza el abono en ese tiempo, el pedido se cancela automáticamente y los productos se liberan.</p>
<p><strong>5. Seguimiento.</strong> Cuando tu pedido sea despachado recibirás el número de guía para hacer seguimiento con la transportadora.</p>
<p><strong>6. Al recibir.</strong> Revisa que el paquete llegue cerrado y en buen estado. Si notas el empaque abierto o dañado, déjalo anotado con el mensajero y repórtanos en las siguientes 24 horas con fotos a través del formulario de garantías.</p>
<p><strong>7. Datos de entrega.</strong> Eres responsable de que la dirección y el teléfono sean correctos. Si la transportadora no logra entregar por datos errados o ausencia, coordinaremos un nuevo intento; si el pedido regresa, te contactaremos para reprogramarlo.</p>
<p><strong>8. Rechazo del pedido.</strong> Si un pedido contra entrega es rechazado sin causa justificada al momento de la entrega, el abono se destinará a cubrir los costos logísticos del envío y la devolución. [CONFIRMAR decisión del negocio]</p>$html$, 1),

('CO', 'tratamiento-de-datos', 'Política de tratamiento de datos personales', $html$<p><strong>Responsable.</strong> [RAZÓN SOCIAL], NIT [NIT], domicilio en [DIRECCIÓN, CIUDAD], correo [CORREO], teléfono [TELÉFONO] ("Izao Perfumería").</p>
<p><strong>Marco legal.</strong> Ley 1581 de 2012, Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y demás normas aplicables.</p>
<p><strong>Datos que recolectamos.</strong> Nombre, documento de identidad, celular, correo, dirección de entrega, historial de pedidos, conversaciones con nuestro asistente virtual y con asesores, datos de navegación y de dispositivos (cookies y píxeles), y las fotos o descripciones que envíes en solicitudes de garantía. No almacenamos datos de tarjetas: los procesan directamente las pasarelas de pago.</p>
<p><strong>Finalidades.</strong></p>
<ol>
<li>Procesar, despachar y entregar tus pedidos.</li>
<li>Gestionar pagos, abonos y financiación con las entidades correspondientes.</li>
<li>Enviarte por WhatsApp, correo o SMS información de tu pedido, incluidos los links de pago y recordatorios.</li>
<li>Atender consultas, peticiones, quejas, reclamos y garantías.</li>
<li>Con tu autorización expresa: enviarte promociones, novedades y códigos de descuento.</li>
<li>Medir y mejorar nuestro sitio y nuestras campañas publicitarias.</li>
<li>Prevenir fraudes y cumplir obligaciones legales.</li>
</ol>
<p><strong>Encargados y transferencias.</strong> Para cumplir estas finalidades compartimos los datos estrictamente necesarios con: pasarelas de pago (Wompi, Addi, Sistecrédito), plataforma logística y transportadoras (MasterShop y sus aliados), Meta Platforms (WhatsApp), proveedores de infraestructura tecnológica y bases de datos, proveedores de inteligencia artificial que operan el asistente virtual, y plataformas de analítica y publicidad. Algunos de estos proveedores tienen servidores fuera de Colombia; al aceptar esta política autorizas dicha transferencia o transmisión internacional, que se realiza con medidas de seguridad adecuadas.</p>
<p><strong>Tus derechos.</strong> Conocer, actualizar y rectificar tus datos; solicitar prueba de la autorización; ser informado sobre el uso de tus datos; revocar la autorización y solicitar la supresión cuando no exista un deber legal o contractual de conservarlos; acceder gratuitamente a tus datos; y presentar quejas ante la Superintendencia de Industria y Comercio.</p>
<p><strong>Cómo ejercerlos.</strong> Escribe a [CORREO] indicando tu nombre, documento, solicitud y medio de respuesta. Las consultas se responden en máximo 10 días hábiles (prorrogables por 5 más) y los reclamos en máximo 15 días hábiles (prorrogables por 8 más), conforme a la ley.</p>
<p><strong>Cookies y píxeles.</strong> Usamos cookies propias y de terceros para el funcionamiento del sitio, analítica y publicidad. Puedes aceptarlas o rechazarlas desde el aviso de cookies y configurarlas en tu navegador.</p>
<p><strong>Menores de edad.</strong> Nuestro sitio no está dirigido a menores de edad y no recolectamos intencionalmente sus datos.</p>
<p><strong>Seguridad.</strong> Aplicamos medidas técnicas y administrativas razonables para proteger tu información.</p>
<p><strong>Vigencia.</strong> Esta política rige desde [FECHA] y puede actualizarse; publicaremos cualquier cambio en esta página. Las bases de datos se conservarán mientras sea necesario para las finalidades descritas.</p>$html$, 1),

('CO', 'terminos-y-condiciones', 'Términos y condiciones', $html$<p><strong>1. Quiénes somos.</strong> Este sitio es operado por [RAZÓN SOCIAL], NIT [NIT]. Al usarlo y comprar en él aceptas estos términos.</p>
<p><strong>2. Productos.</strong> Comercializamos fragancias, lociones y productos relacionados. Las fotografías son ilustrativas: el empaque, el color o el diseño del envase pueden variar ligeramente. La percepción, duración y estela de una fragancia varían según la piel, el clima y la cantidad aplicada. Las descripciones olfativas son orientativas.</p>
<p><strong>3. Marcas de terceros.</strong> Los nombres, marcas o referencias de terceros que puedan mencionarse en el sitio pertenecen a sus respectivos titulares. Izao Perfumería no declara afiliación, patrocinio ni representación de dichos titulares.</p>
<p><strong>4. Precios.</strong> Están expresados en pesos colombianos (en Ecuador, en dólares) e incluyen los impuestos aplicables. Pueden cambiar sin previo aviso, pero se respeta el precio confirmado en tu pedido. Si por un error evidente un producto se publica con un precio manifiestamente equivocado, te contactaremos para confirmar o anular el pedido con reembolso total.</p>
<p><strong>5. Disponibilidad.</strong> Los pedidos están sujetos a existencias. Si después de confirmado un pedido un producto no está disponible, te ofreceremos otra opción o el reembolso.</p>
<p><strong>6. Medios de pago.</strong></p>
<ul>
<li>Pago en línea con Wompi.</li>
<li>Financiación con Addi o Sistecrédito: estas opciones tienen un cargo por financiación del [10 %] sobre el valor de los productos, que se muestra antes de pagar. Las condiciones del crédito son definidas por cada entidad.</li>
<li>Contra entrega: requiere un abono previo de [$10.000] por link de pago (ver Política de envíos).</li>
</ul>
<p><strong>7. Códigos de descuento.</strong> Se permite un código por pedido. No son acumulables, no aplican para compras con Addi o Sistecrédito, tienen vigencia y condiciones propias, y no son canjeables por dinero.</p>
<p><strong>8. Formación del contrato.</strong> El pedido queda confirmado cuando recibes la confirmación del pago o del abono. Te enviaremos el resumen al correo y/o WhatsApp registrados.</p>
<p><strong>9. Envíos.</strong> Según la Política de envíos.</p>
<p><strong>10. Derecho de retracto, garantía y devoluciones.</strong> Según la Política de devoluciones y garantías.</p>
<p><strong>11. Reversión del pago.</strong> Cuando hayas pagado por medios electrónicos, puedes solicitar la reversión del pago en los casos previstos en el artículo 51 de la Ley 1480 de 2011 (fraude, operación no solicitada, producto no recibido, producto que no corresponde a lo solicitado o defectuoso), dentro de los 5 días hábiles siguientes a que tuviste noticia del hecho, informándonos y al emisor del medio de pago.</p>
<p><strong>12. Cuenta de usuario.</strong> Eres responsable de la confidencialidad de tu contraseña y de la veracidad de tus datos.</p>
<p><strong>13. Asistente virtual.</strong> Iza es un asistente virtual con inteligencia artificial que orienta sobre nuestros productos y políticas. Puede cometer errores; prevalecen siempre la información de la ficha del producto, el resumen del checkout y estas políticas.</p>
<p><strong>14. Propiedad del contenido.</strong> Los textos, fotografías, diseño y logotipos propios de Izao Perfumería no pueden usarse sin autorización.</p>
<p><strong>15. Atención al cliente (PQR).</strong> [CORREO] · WhatsApp [NÚMERO] · Horario [HORARIO].</p>
<p><strong>16. Ley aplicable.</strong> Estos términos se rigen por las leyes de la República de Colombia, en especial la Ley 1480 de 2011 (Estatuto del Consumidor).</p>$html$, 1),

('CO', 'devoluciones-y-garantias', 'Política de devoluciones y garantías', $html$<p><strong>1. Derecho de retracto (compras a distancia).</strong> Puedes retractarte de tu compra dentro de los <strong>5 días hábiles</strong> siguientes a la entrega, conforme al artículo 47 de la Ley 1480 de 2011, siempre que el producto se devuelva <strong>sin abrir, con su sello y empaque original</strong> y en las mismas condiciones en que lo recibiste. Los costos de transporte de la devolución corren por tu cuenta. Por tratarse de bienes de uso personal, no se aceptan retractos de productos abiertos o usados. El reembolso se realiza por el mismo medio de pago en un plazo máximo de 30 días calendario desde que recibimos el producto.</p>
<p><strong>2. Garantía de calidad.</strong> Durante los <strong>[30] días</strong> siguientes a la entrega, respondemos si tu producto presenta:</p>
<ul>
<li>Atomizador o válvula defectuosa.</li>
<li>Fuga o envase roto al recibirlo.</li>
<li>Producto distinto al que pediste o faltante en el paquete.</li>
<li>Daños de transporte reportados en las primeras 24 horas.</li>
</ul>
<p><strong>3. No cubre.</strong> Preferencias personales sobre el aroma después de abierto el producto, reacciones de sensibilidad en la piel (te recomendamos probar primero en una pequeña zona), uso inadecuado, exposición prolongada al calor o al sol, ni diferencias de duración o proyección que dependen del tipo de piel y del clima.</p>
<p><strong>4. Cómo solicitarla.</strong> Diligencia el formulario de garantías en [URL]/garantias con tu número de pedido, el celular con el que compraste, el motivo y fotos o video del producto y su empaque. Recibirás un número de caso y te responderemos en máximo [5] días hábiles.</p>
<p><strong>5. Soluciones.</strong> Según el caso: reposición del producto, cambio por otro de igual valor o reembolso. Si la garantía procede, nosotros asumimos los costos de envío.</p>
<p><strong>6. Contra entrega.</strong> Si rechazas el pedido al momento de la entrega por una causa cubierta por esta política (paquete abierto, producto distinto), repórtalo en el formulario y te reintegraremos el abono.</p>$html$, 1)
on conflict (country_code, slug) do nothing;

-- Ecuador: borrador base de Colombia + ajustes del Anexo A para Ecuador al inicio (pendiente de adaptar).
insert into public.pages (country_code, slug, title, content_html, version, status)
select 'EC', p.slug, p.title,
  case when n.note is null then p.content_html
       else '<aside data-ajuste="ecuador"><p><strong>Ajustes para Ecuador (pendiente de adaptar):</strong> ' || n.note || '</p></aside>' || E'\n' || p.content_html end,
  1, 'draft'
from public.pages p
left join (values
  ('politica-de-envios', 'cobertura según la transportadora aliada en Ecuador [COMPLETAR]; valores en USD; tiempos de entrega [COMPLETAR]; el abono contra entrega aplica cuando ese método esté habilitado.'),
  ('tratamiento-de-datos', 'marco legal Ley Orgánica de Protección de Datos Personales y su reglamento; derechos de acceso, rectificación y actualización, eliminación, oposición, portabilidad y suspensión del tratamiento; autoridad: Superintendencia de Protección de Datos Personales; responsable y datos de contacto en Ecuador [COMPLETAR]; plazos de respuesta según la ley ecuatoriana.'),
  ('terminos-y-condiciones', 'precios en USD; legislación aplicable: Ley Orgánica de Defensa del Consumidor; sustituir el numeral 11 por los mecanismos de reclamo previstos en la ley ecuatoriana [VERIFICAR con abogado]; datos de contacto en Ecuador [COMPLETAR].'),
  ('devoluciones-y-garantias', 'plazo de devolución en compras a distancia según el artículo 45 de la Ley Orgánica de Defensa del Consumidor (3 días) [VERIFICAR con abogado]; demás condiciones iguales; montos en USD.')
) as n(slug, note) on n.slug = p.slug
where p.country_code = 'CO'
on conflict (country_code, slug) do nothing;

commit;
