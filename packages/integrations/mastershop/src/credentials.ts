/**
 * Esquema declarado de credenciales de MasterShop (§12.1, §26.3). El panel genera el
 * formulario desde aquí y guarda cifrado en `integration_credentials`.
 */
import { validateCredentials } from '@izao/core/contracts';
import type { CredentialSchema } from '@izao/core/contracts';

export const MASTERSHOP_CREDENTIALS: CredentialSchema = {
  provider: 'mastershop',
  // Una credencial independiente por país (D-052): MasterShop deriva de la llave el negocio, el país y la moneda.
  countries: ['CO', 'EC'],
  // `[VERIFICAR]`: la documentación solo publica la base de producción.
  environments: ['production'],
  fields: [
    {
      key: 'api_key',
      label: 'Llave de API (ms-api-key)',
      secret: true,
      required: true,
      kind: 'text',
      help: 'Se crea en el panel de MasterShop. Se guarda cifrada y nunca se muestra completa.',
    },
  ],
};

export interface MasterShopCredentials {
  apiKey: string;
}

/** Lee la credencial descifrada; `null` si no cumple el esquema. */
export function parseMasterShopCredentials(values: unknown): MasterShopCredentials | null {
  if (typeof values !== 'object' || values === null) return null;
  const record = values as Record<string, unknown>;
  if (validateCredentials(MASTERSHOP_CREDENTIALS, record).length > 0) return null;
  const apiKey = record.api_key;
  return typeof apiKey === 'string' ? { apiKey: apiKey.trim() } : null;
}
