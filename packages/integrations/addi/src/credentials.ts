/**
 * Esquema declarado de credenciales de Addi (§12.3, §26.3, D-031). El panel genera el formulario desde aquí y
 * guarda cifrado en `integration_credentials` (provider `addi`, país `CO`, ambiente).
 *
 * Verificado en la documentación oficial (api-docs-sandbox.addi.com, /auth y /integration):
 * - Token OAuth `client_credentials` en Auth0 con `client_id`, `client_secret` y `audience` por ambiente.
 * - El callback lo consume Addi con autenticación HTTP Basic; usuario y clave los define el comercio y se
 *   entregan a Addi durante la integración. La clave exige 16+ caracteres (decisión propia, D-031).
 * - `ally_slug` no lo usa la API de e-commerce (el `client_id` ya identifica aliado y tienda): queda opcional.
 */
import { validateCredentials } from '@izao/core/contracts';
import type { CredentialSchema, CredentialValidationIssue, Environment } from '@izao/core/contracts';

export const ADDI_CREDENTIALS: CredentialSchema = {
  provider: 'addi',
  countries: ['CO'],
  environments: ['sandbox', 'production'],
  fields: [
    { key: 'client_id', label: 'Client ID', secret: false, required: true, kind: 'text', help: 'Lo entrega Addi por correo cifrado.' },
    { key: 'client_secret', label: 'Client secret', secret: true, required: true, kind: 'text' },
    {
      key: 'callback_username',
      label: 'Usuario del callback',
      secret: false,
      required: true,
      kind: 'text',
      help: 'Lo defines tú y se lo entregas a Addi; Addi lo usa para autenticarse al notificar.',
    },
    {
      key: 'callback_password',
      label: 'Clave del callback',
      secret: true,
      required: true,
      kind: 'text',
      help: 'Mínimo 16 caracteres. Se entrega a Addi por un canal seguro.',
    },
    { key: 'ally_slug', label: 'Slug del aliado', secret: false, required: false, kind: 'text', help: 'Opcional.' },
  ],
};

export interface AddiCredentials {
  ambiente: Environment;
  clientId: string;
  clientSecret: string;
  usuarioCallback: string;
  claveCallback: string;
  allySlug: string | null;
}

export interface EndpointsAddi {
  auth: string;
  audience: string;
  api: string;
  /**
   * Dominios (y sus subdominios) aceptados en el `Location` del 301 de la solicitud. La documentación solo dice
   * "URL de redirección al sitio de ADDI" (D-036): fuera de ellos la URL nunca llega al navegador.
   */
  dominiosRedireccion: readonly string[];
}

export const ADDI_ENDPOINTS: Readonly<Record<Environment, EndpointsAddi>> = Object.freeze({
  sandbox: {
    auth: 'https://auth.addi-staging.com/oauth/token',
    audience: 'https://api.staging.addi.com',
    api: 'https://api.addi-staging.com',
    dominiosRedireccion: ['addi-staging.com', 'addi.com'],
  },
  production: {
    auth: 'https://auth.addi.com/oauth/token',
    audience: 'https://api.addi.com',
    api: 'https://api.addi.com',
    dominiosRedireccion: ['addi.com'],
  },
});

export type ResultadoCredencialesAddi =
  | { ok: true; credenciales: AddiCredentials }
  | { ok: false; problemas: CredentialValidationIssue[] };

const MIN_CLAVE_CALLBACK = 16;

/** Valida contra el esquema. Los problemas nunca incluyen valores. */
export function parseAddiCredentials(values: unknown, ambiente: Environment): ResultadoCredencialesAddi {
  if (typeof values !== 'object' || values === null) {
    return { ok: false, problemas: [{ key: '*', code: 'REQUIRED', message: 'Credenciales vacías.' }] };
  }
  if (!(ambiente in ADDI_ENDPOINTS)) {
    return { ok: false, problemas: [{ key: '*', code: 'INVALID_OPTION', message: 'Ambiente inválido.' }] };
  }
  const record = values as Record<string, unknown>;
  const problemas = validateCredentials(ADDI_CREDENTIALS, record);
  const v = (k: string): string => (typeof record[k] === 'string' ? (record[k] as string).trim() : '');
  if (v('callback_password') !== '' && v('callback_password').length < MIN_CLAVE_CALLBACK) {
    problemas.push({ key: 'callback_password', code: 'INVALID_OPTION', message: `Debe tener al menos ${MIN_CLAVE_CALLBACK} caracteres.` });
  }
  if (v('callback_username').includes(':')) {
    problemas.push({ key: 'callback_username', code: 'INVALID_OPTION', message: 'No puede contener ":".' });
  }
  if (problemas.length > 0) return { ok: false, problemas };
  return {
    ok: true,
    credenciales: {
      ambiente,
      clientId: v('client_id'),
      clientSecret: v('client_secret'),
      usuarioCallback: v('callback_username'),
      claveCallback: v('callback_password'),
      allySlug: v('ally_slug') || null,
    },
  };
}
