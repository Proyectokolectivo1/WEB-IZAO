-- Pruebas pgtap · 20261021011746: activar_plantilla_whatsapp(p_id, p_meta_template_id) atómica.
begin;
set local search_path = public, extensions;
select plan(14);

insert into public.currencies (code, exponent, symbol, format_pattern) values ('COP', 0, '$', '$ #.##0') on conflict do nothing;
insert into public.countries (code, name, currency_code, locale, timezone, phone_prefix)
  values ('CO', 'Colombia', 'COP', 'es-CO', 'America/Bogota', '+57') on conflict do nothing;

-- v1 activa, v2 pendiente (nueva), v3 activa de otra clave
insert into public.whatsapp_templates (id, key, country_code, meta_template_name, body_text, version, meta_status, is_active) values
  ('b0000000-0000-0000-0000-0000000024a1', 'pgtap_act', 'CO', 'pgtap_act', 'Hola {{1}}', 1, 'approved', true),
  ('b0000000-0000-0000-0000-0000000024a2', 'pgtap_act', 'CO', 'pgtap_act_v2', 'Hola {{1}}', 2, 'pending', false),
  ('b0000000-0000-0000-0000-0000000024a3', 'pgtap_act', 'CO', 'pgtap_act_v3', 'Hola {{1}}', 3, 'rejected', false),
  ('b0000000-0000-0000-0000-0000000024b1', 'pgtap_otra', 'CO', 'pgtap_otra', 'Hola', 1, 'approved', true);
update public.whatsapp_templates set meta_rejection_reason = 'texto' where id = 'b0000000-0000-0000-0000-0000000024a3';

create temp table r (k text primary key, v jsonb);

select ok(not has_function_privilege('anon', 'public.activar_plantilla_whatsapp(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.activar_plantilla_whatsapp(uuid, text)', 'execute')
          and has_function_privilege('service_role', 'public.activar_plantilla_whatsapp(uuid, text)', 'execute'),
          'solo service_role ejecuta activar_plantilla_whatsapp');

-- v2 (más nueva que la activa v1) se activa
insert into r values ('a2', public.activar_plantilla_whatsapp('b0000000-0000-0000-0000-0000000024a2', 'meta-2'));
select is(r.v->>'estado', 'activada', 'versión más nueva: activada') from r where k = 'a2';
select is((r.v->>'anterior_version')::int, 1, 'informa la versión anterior') from r where k = 'a2';
select is((select string_agg(version::text, ',' order by version) from public.whatsapp_templates where key = 'pgtap_act' and is_active),
          '2', 'queda una sola activa: la v2');
select is((select meta_status || '/' || meta_template_id from public.whatsapp_templates where id = 'b0000000-0000-0000-0000-0000000024a2'),
          'approved/meta-2', 'v2 approved con meta_template_id');
select ok((select is_active from public.whatsapp_templates where id = 'b0000000-0000-0000-0000-0000000024b1'), 'no toca otras claves');

-- v1 (más vieja que la activa v2) no se activa
insert into r values ('a1', public.activar_plantilla_whatsapp('b0000000-0000-0000-0000-0000000024a1', null));
select is(r.v->>'estado', 'aprobada_sin_activar', 'versión más vieja: aprobada sin activar') from r where k = 'a1';
select is((r.v->>'activa_version')::int, 2, 'informa la versión activa') from r where k = 'a1';
select is((select version from public.whatsapp_templates where key = 'pgtap_act' and is_active), 2, 'la v2 sigue activa');

-- v2 otra vez: ya activa, idempotente y conserva meta_template_id
insert into r values ('a2b', public.activar_plantilla_whatsapp('b0000000-0000-0000-0000-0000000024a2', null));
select is(r.v->>'estado', 'ya_activa', 'repetir: ya_activa') from r where k = 'a2b';
select is((select meta_template_id from public.whatsapp_templates where id = 'b0000000-0000-0000-0000-0000000024a2'), 'meta-2',
          'sin meta_template_id conserva el anterior');

-- v3 rechazada antes, ahora aprobada: se activa y limpia el motivo
insert into r values ('a3', public.activar_plantilla_whatsapp('b0000000-0000-0000-0000-0000000024a3', 'meta-3'));
select is((select meta_status || '/' || coalesce(meta_rejection_reason, '-') || '/' || is_active::text
             from public.whatsapp_templates where id = 'b0000000-0000-0000-0000-0000000024a3'),
          'approved/-/true', 'v3 activa, approved y sin motivo de rechazo');

select is(public.activar_plantilla_whatsapp('b0000000-0000-0000-0000-00000000ffff')->>'motivo', 'no_existe', 'id inexistente: no_existe');
select is(public.activar_plantilla_whatsapp(null)->>'motivo', 'datos_invalidos', 'id nulo: datos_invalidos');

select * from finish();
rollback;
