import 'server-only';
/**
 * Credencial activa de WhatsApp del país, descifrada solo en memoria del servidor (§26.3). Nunca se devuelve
 * a un componente ni se escribe en logs: el llamador la usa para crear el cliente de la API y la descarta.
 */
import { byteaDesdePostgrest, descifrarCredenciales } from '@izao/core/credentials';
import { leerCredencialesWhatsApp, type CredencialesWhatsApp } from '@izao/whatsapp';
import type { Cliente } from '../catalogo/taxonomias-servidor';

export async function credencialesWhatsAppActivas(
  cliente: Cliente,
  pais: 'CO' | 'EC',
  claveCifrado: string | undefined = process.env.APP_ENCRYPTION_KEY,
): Promise<CredencialesWhatsApp | null> {
  if (!claveCifrado) return null;
  const { data, error } = await cliente
    .from('integration_credentials')
    .select('environment,data_encrypted,iv,key_version')
    .eq('provider', 'whatsapp')
    .eq('country_code', pais)
    .eq('is_active', true);
  if (error || !data || data.length !== 1) return null;
  const r = data[0] as Record<string, unknown>;
  const ambiente = r.environment === 'production' ? 'production' : 'sandbox';
  try {
    const valores = await descifrarCredenciales(
      claveCifrado,
      { provider: 'whatsapp', country_code: pais, environment: ambiente },
      {
        data_encrypted: byteaDesdePostgrest(String(r.data_encrypted)),
        iv: byteaDesdePostgrest(String(r.iv)),
        key_version: Number(r.key_version),
      },
    );
    return leerCredencialesWhatsApp(valores);
  } catch (e) {
    console.error(`[whatsapp] credenciales ilegibles: ${e instanceof Error ? e.name : 'error'}`);
    return null;
  }
}
