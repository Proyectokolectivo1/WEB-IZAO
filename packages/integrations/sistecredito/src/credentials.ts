/**
 * Esquema declarado de credenciales de Sistecrédito (§12.4, §26.3, D-032). El panel genera el formulario desde
 * aquí y guarda cifrado en `integration_credentials` (provider `sistecredito`, país `CO`, ambiente).
 *
 * `[VERIFICAR]`: Sistecrédito no publica documentación técnica abierta; los campos son el **esquema inicial** de
 * la especificación (llave de suscripción, application key, application token, comercio y tienda) y se ajustan
 * cuando el dueño entregue la documentación de su contrato (`docs/integraciones/`). No hay endpoints aquí:
 * ninguna URL de Sistecrédito se inventa.
 */
import { validateCredentials } from '@izao/core/contracts';
import type { CredentialSchema, CredentialValidationIssue, Environment } from '@izao/core/contracts';

export const SISTECREDITO_CREDENTIALS: CredentialSchema = {
  provider: 'sistecredito',
  countries: ['CO'],
  environments: ['sandbox', 'production'],
  fields: [
    { key: 'subscription_key', label: 'Llave de suscripción', secret: true, required: true, kind: 'text', help: 'La entrega Sistecrédito.' },
    { key: 'application_key', label: 'Application key', secret: true, required: true, kind: 'text' },
    { key: 'application_token', label: 'Application token', secret: true, required: true, kind: 'text' },
    { key: 'merchant_id', label: 'Identificador del comercio', secret: false, required: true, kind: 'text' },
    { key: 'store_id', label: 'Identificador de la tienda', secret: false, required: false, kind: 'text', help: 'Opcional según el contrato.' },
  ],
};

export interface SistecreditoCredentials {
  ambiente: Environment;
  subscriptionKey: string;
  applicationKey: string;
  applicationToken: string;
  merchantId: string;
  storeId: string | null;
}

export type ResultadoCredencialesSistecredito =
  | { ok: true; credenciales: SistecreditoCredentials }
  | { ok: false; problemas: CredentialValidationIssue[] };

const AMBIENTES: readonly Environment[] = SISTECREDITO_CREDENTIALS.environments;

/** Valida contra el esquema. Los problemas nunca incluyen valores. */
export function parseSistecreditoCredentials(values: unknown, ambiente: Environment): ResultadoCredencialesSistecredito {
  if (typeof values !== 'object' || values === null) {
    return { ok: false, problemas: [{ key: '*', code: 'REQUIRED', message: 'Credenciales vacías.' }] };
  }
  if (!AMBIENTES.includes(ambiente)) {
    return { ok: false, problemas: [{ key: '*', code: 'INVALID_OPTION', message: 'Ambiente inválido.' }] };
  }
  const record = values as Record<string, unknown>;
  const problemas = validateCredentials(SISTECREDITO_CREDENTIALS, record);
  if (problemas.length > 0) return { ok: false, problemas };
  const v = (k: string): string => (typeof record[k] === 'string' ? (record[k] as string).trim() : '');
  return {
    ok: true,
    credenciales: {
      ambiente,
      subscriptionKey: v('subscription_key'),
      applicationKey: v('application_key'),
      applicationToken: v('application_token'),
      merchantId: v('merchant_id'),
      storeId: v('store_id') || null,
    },
  };
}
