/**
 * Esquema declarado de credenciales de Wompi (§12.1, §12.2, §26.3). El panel genera el formulario desde
 * aquí y guarda cifrado en `integration_credentials` (provider `wompi`, país `CO`, ambiente).
 * Prefijos por ambiente según docs.wompi.co (D-024): sandbox `pub_test_`, `prv_test_`, `test_events_`,
 * `test_integrity_`; producción `pub_prod_`, `prv_prod_`, `prod_events_`, `prod_integrity_`.
 */
import { validateCredentials } from '@izao/core/contracts';
import type { CredentialSchema, CredentialValidationIssue, Environment } from '@izao/core/contracts';

export const WOMPI_CREDENTIALS: CredentialSchema = {
  provider: 'wompi',
  countries: ['CO'],
  environments: ['sandbox', 'production'],
  fields: [
    { key: 'public_key', label: 'Llave pública', secret: false, required: true, kind: 'text' },
    { key: 'private_key', label: 'Llave privada', secret: true, required: true, kind: 'text' },
    {
      key: 'events_secret',
      label: 'Secreto de eventos',
      secret: true,
      required: true,
      kind: 'text',
      help: 'En el panel de Wompi: Desarrolladores > Secretos para integración técnica.',
    },
    { key: 'integrity_secret', label: 'Secreto de integridad', secret: true, required: true, kind: 'text' },
  ],
};

export interface WompiCredentials {
  ambiente: Environment;
  llavePublica: string;
  llavePrivada: string;
  secretoEventos: string;
  secretoIntegridad: string;
}

const PREFIJOS: Record<Environment, Record<string, string>> = {
  sandbox: {
    public_key: 'pub_test_',
    private_key: 'prv_test_',
    events_secret: 'test_events_',
    integrity_secret: 'test_integrity_',
  },
  production: {
    public_key: 'pub_prod_',
    private_key: 'prv_prod_',
    events_secret: 'prod_events_',
    integrity_secret: 'prod_integrity_',
  },
};

export type ResultadoCredenciales =
  | { ok: true; credenciales: WompiCredentials }
  | { ok: false; problemas: CredentialValidationIssue[] };

/** Valida contra el esquema y el ambiente. Los problemas nunca incluyen valores. */
export function parseWompiCredentials(values: unknown, ambiente: Environment): ResultadoCredenciales {
  if (typeof values !== 'object' || values === null) {
    return { ok: false, problemas: [{ key: '*', code: 'REQUIRED', message: 'Credenciales vacías.' }] };
  }
  const record = values as Record<string, unknown>;
  const problemas = validateCredentials(WOMPI_CREDENTIALS, record);
  const prefijos = PREFIJOS[ambiente];
  if (!prefijos) return { ok: false, problemas: [{ key: '*', code: 'INVALID_OPTION', message: 'Ambiente inválido.' }] };
  for (const [key, prefijo] of Object.entries(prefijos)) {
    const v = record[key];
    if (typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith(prefijo)) {
      problemas.push({ key, code: 'INVALID_OPTION', message: `No corresponde al ambiente ${ambiente}.` });
    }
  }
  if (problemas.length > 0) return { ok: false, problemas };
  const v = (k: string) => String(record[k]).trim();
  return {
    ok: true,
    credenciales: {
      ambiente,
      llavePublica: v('public_key'),
      llavePrivada: v('private_key'),
      secretoEventos: v('events_secret'),
      secretoIntegridad: v('integrity_secret'),
    },
  };
}

export const WOMPI_API_BASE: Record<Environment, string> = {
  sandbox: 'https://sandbox.wompi.co/v1',
  production: 'https://production.wompi.co/v1',
};
