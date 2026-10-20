/**
 * Esquema de credenciales de WhatsApp Cloud API (§13.2, §26.3). El panel genera el formulario desde aquí y guarda
 * cifrado en `integration_credentials` (provider `whatsapp`). La versión de Graph es dato del panel (defecto v26.0).
 */
import type { CredentialSchema } from '@izao/core/contracts';
import type { CredencialesWhatsApp } from './cliente';

export const VERSION_GRAPH_POR_DEFECTO = 'v26.0';

export const WHATSAPP_CREDENTIALS: CredentialSchema = {
  provider: 'whatsapp',
  countries: ['CO', 'EC'],
  environments: ['production'],
  fields: [
    { key: 'phone_number_id', label: 'Phone number ID', secret: false, required: true, kind: 'text' },
    { key: 'waba_id', label: 'WhatsApp Business Account ID', secret: false, required: true, kind: 'text' },
    { key: 'access_token', label: 'Token de acceso permanente (usuario del sistema)', secret: true, required: true, kind: 'text' },
    { key: 'app_secret', label: 'App secret (valida el webhook)', secret: true, required: true, kind: 'text' },
    { key: 'verify_token', label: 'Token de verificación del webhook', secret: true, required: true, kind: 'text' },
    { key: 'graph_version', label: 'Versión de Graph API', secret: false, required: false, kind: 'text', help: 'Por defecto v26.0.' },
  ],
};

/** Valores descifrados → credenciales tipadas; `null` si falta algo o el formato no cuadra. */
export function leerCredencialesWhatsApp(v: Readonly<Record<string, string | undefined>>): CredencialesWhatsApp | null {
  const pn = v.phone_number_id?.trim();
  const waba = v.waba_id?.trim();
  const version = v.graph_version?.trim() || VERSION_GRAPH_POR_DEFECTO;
  if (!pn || !waba || !/^\d{5,30}$/.test(pn) || !/^\d{5,30}$/.test(waba)) return null;
  if (!v.access_token || !v.app_secret || !v.verify_token || !/^v\d{1,3}\.\d$/.test(version)) return null;
  return {
    phoneNumberId: pn,
    wabaId: waba,
    tokenAcceso: v.access_token,
    appSecret: v.app_secret,
    tokenVerificacion: v.verify_token,
    versionGraph: version,
  };
}
