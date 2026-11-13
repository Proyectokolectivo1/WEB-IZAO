import 'server-only';
/**
 * WhatsApp del asesor por país con el cliente de servicio: lectura y escritura de
 * `country_settings.advisor_whatsapp|advisor_whatsapp_message|advisor_whatsapp_button_enabled`. El número se normaliza
 * AQUÍ (solo dígitos con el código de `countries.phone_prefix`); la base además lo exige con un check. Cada escritura se audita.
 */
import { auditarCambio } from '@/lib/admin/auditoria';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { diffCampos, type ErroresCampo, type ResultadoAccion } from '../crud/comun';
import { traducirErrorBd } from '../crud/servidor';
import type { PaisAjustes } from './ajustes';
import { normalizarWhatsapp, type DatosWhatsappAsesor, type FormularioWhatsappAsesor } from './whatsapp-asesor';

type Fila = Record<string, unknown>;
type Ctx = { cliente: Cliente; actor: string; ip: string | null };
export type ResultadoWhatsapp = ResultadoAccion & { errores?: ErroresCampo };

const COLUMNAS = 'advisor_whatsapp, advisor_whatsapp_message, advisor_whatsapp_button_enabled, updated_at';
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export async function leerWhatsappAsesor(cliente: Cliente, pais: PaisAjustes): Promise<FormularioWhatsappAsesor | null> {
  const [cs, c] = await Promise.all([
    cliente.from('country_settings').select(COLUMNAS).eq('country_code', pais).maybeSingle(),
    cliente.from('countries').select('phone_prefix').eq('code', pais).maybeSingle(),
  ]);
  if (cs.error) throw new Error(`No se pudo leer el WhatsApp del asesor: ${cs.error.message}`);
  if (c.error) throw new Error(`No se pudo leer el país: ${c.error.message}`);
  if (!cs.data) return null;
  const f = cs.data as Fila;
  return {
    advisor_whatsapp: txt(f.advisor_whatsapp),
    advisor_whatsapp_message: txt(f.advisor_whatsapp_message),
    advisor_whatsapp_button_enabled: f.advisor_whatsapp_button_enabled !== false,
    prefijo: txt((c.data as Fila | null)?.phone_prefix),
    updated_at: f.updated_at ? String(f.updated_at) : null,
  };
}

export async function guardarWhatsappAsesorBd(args: Ctx & { pais: PaisAjustes; datos: DatosWhatsappAsesor }): Promise<ResultadoWhatsapp> {
  const { cliente, pais, datos, actor, ip } = args;

  const [previa, pref] = await Promise.all([
    cliente.from('country_settings').select(COLUMNAS).eq('country_code', pais).maybeSingle(),
    cliente.from('countries').select('phone_prefix').eq('code', pais).maybeSingle(),
  ]);
  if (previa.error) return { ok: false, mensaje: traducirErrorBd(previa.error).mensaje };
  if (pref.error) return { ok: false, mensaje: traducirErrorBd(pref.error).mensaje };
  if (!previa.data) return { ok: false, mensaje: 'Ese país no tiene ajustes cargados.' };
  const antes = previa.data as Fila;

  let numero: string | null = null;
  if (datos.numero.trim() !== '') {
    const r = normalizarWhatsapp(datos.numero, txt((pref.data as Fila | null)?.phone_prefix));
    if (!r.ok) return { ok: false, mensaje: 'Revisa los campos marcados.', errores: { advisor_whatsapp: r.mensaje } };
    numero = r.valor;
  }

  const nuevo = {
    advisor_whatsapp: numero,
    advisor_whatsapp_message: datos.mensaje,
    advisor_whatsapp_button_enabled: datos.activo,
  };
  const { error } = await cliente.from('country_settings').update(nuevo).eq('country_code', pais);
  if (error) return { ok: false, mensaje: traducirErrorBd(error).mensaje };

  await auditarCambio({
    actor,
    accion: 'pagos.whatsapp_asesor_actualizado',
    entidad: 'country_settings',
    entidadId: pais,
    ip,
    diff: diffCampos(
      {
        advisor_whatsapp: antes.advisor_whatsapp ?? null,
        advisor_whatsapp_message: antes.advisor_whatsapp_message ?? null,
        advisor_whatsapp_button_enabled: antes.advisor_whatsapp_button_enabled !== false,
      },
      nuevo,
    ),
  });
  return { ok: true, id: pais, mensaje: 'WhatsApp del asesor guardado.' };
}
