import { describe, expect, it } from 'vitest';
import { byteaParaPostgrest, cifrarCredenciales } from '@izao/core/credentials';
import { clienteFalso } from '../crud/cliente-falso';
import { llaveMasterShopActiva } from './externos-servidor';

const CLAVE = Buffer.alloc(32, 7).toString('base64');

async function fila(pais: 'CO' | 'EC', llave: string) {
  const c = await cifrarCredenciales(CLAVE, { provider: 'mastershop', country_code: pais, environment: 'production' }, { api_key: llave });
  return [
    {
      environment: 'production',
      data_encrypted: byteaParaPostgrest(c.data_encrypted),
      iv: byteaParaPostgrest(c.iv),
      key_version: c.key_version,
    },
  ];
}

describe('llaveMasterShopActiva (una llave por país, D-052)', () => {
  it('consulta la credencial activa del país pedido y la descifra con el contexto de ese país', async () => {
    const { cliente, filtros } = clienteFalso({ 'integration_credentials.select': { data: await fila('EC', 'llave-ecuador-0001') } });
    expect(await llaveMasterShopActiva(cliente, 'EC', CLAVE)).toBe('llave-ecuador-0001');
    expect(filtros).toContainEqual({ tabla: 'integration_credentials', metodo: 'eq', args: ['country_code', 'EC'] });
  });

  it('no usa la llave de otro país: una credencial de Colombia no abre la de Ecuador', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: await fila('CO', 'llave-colombia-0001') } });
    expect(await llaveMasterShopActiva(cliente, 'EC', CLAVE)).toBeNull();
    expect(await llaveMasterShopActiva(cliente, 'CO', CLAVE)).toBe('llave-colombia-0001');
  });

  it('devuelve null si no hay llave activa o falta la clave de cifrado', async () => {
    const { cliente } = clienteFalso({ 'integration_credentials.select': { data: [] } });
    expect(await llaveMasterShopActiva(cliente, 'EC', CLAVE)).toBeNull();
    expect(await llaveMasterShopActiva(cliente, 'EC', undefined)).toBeNull();
  });
});
