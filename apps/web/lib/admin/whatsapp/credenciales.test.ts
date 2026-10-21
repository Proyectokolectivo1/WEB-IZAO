import { describe, expect, it, vi } from 'vitest';
import { byteaParaPostgrest, cifrarCredenciales } from '@izao/core/credentials';
import { clienteFalso } from '../crud/cliente-falso';
import { credencialesWhatsAppActivas } from './credenciales';

const CLAVE = Buffer.alloc(32, 7).toString('base64');
const VALORES = {
  phone_number_id: '1234567890',
  waba_id: '9876543210',
  access_token: 'tok',
  app_secret: 'sec',
  verify_token: 'ver',
};

async function filaCifrada(pais = 'CO', valores: Record<string, string> = VALORES) {
  const c = await cifrarCredenciales(CLAVE, { provider: 'whatsapp', country_code: pais, environment: 'production' }, valores);
  return { environment: 'production', data_encrypted: byteaParaPostgrest(c.data_encrypted), iv: byteaParaPostgrest(c.iv), key_version: c.key_version };
}

describe('credencialesWhatsAppActivas', () => {
  it('descifra la credencial activa del país', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: [await filaCifrada()] } });
    const r = await credencialesWhatsAppActivas(cliente, 'CO', CLAVE);
    expect(r).toMatchObject({ phoneNumberId: '1234567890', wabaId: '9876543210', tokenAcceso: 'tok', versionGraph: 'v26.0' });
  });

  it('devuelve null sin clave, sin fila, con varias filas o con otro país', async () => {
    const una = await filaCifrada();
    expect(await credencialesWhatsAppActivas(clienteFalso({ 'integration_credentials.select': { data: [una] } }).cliente, 'CO', undefined)).toBeNull();
    expect(await credencialesWhatsAppActivas(clienteFalso({ 'integration_credentials.select': { data: [] } }).cliente, 'CO', CLAVE)).toBeNull();
    expect(await credencialesWhatsAppActivas(clienteFalso({ 'integration_credentials.select': { data: [una, una] } }).cliente, 'CO', CLAVE)).toBeNull();
    // cifrada para EC pero leída como CO: la autenticación del cifrado falla
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ec = await filaCifrada('EC');
    expect(await credencialesWhatsAppActivas(clienteFalso({ 'integration_credentials.select': { data: [ec] } }).cliente, 'CO', CLAVE)).toBeNull();
    espia.mockRestore();
  });

  it('con campos faltantes no entrega credenciales a medias', async () => {
    const incompletas: Record<string, string> = { ...VALORES };
    delete incompletas.access_token;
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: [await filaCifrada('CO', incompletas)] } });
    expect(await credencialesWhatsAppActivas(cliente, 'CO', CLAVE)).toBeNull();
  });
});
