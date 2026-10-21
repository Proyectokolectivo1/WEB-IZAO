import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MasterShopMock } from './mock';
import { registrarWebhooksIzao, urlWebhookIzao } from './webhook-registro';

const LLAVE = 'ms-llave-secreta-webhooks-0001';
const SECRETO = 's'.repeat(40);

function setup() {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: LLAVE, clock });
  return { mock, client: new MasterShopClient({ apiKey: LLAVE, fetch: mock.fetch, clock }) };
}

describe('registro de webhooks de MasterShop', () => {
  it('registra 16 y 17 con idProduct null y devuelve los idProductWebhook, sin la llave que repite la respuesta', async () => {
    const { mock, client } = setup();
    const url = urlWebhookIzao('https://izaoperfumeria.com/co', SECRETO);
    expect(url).toBe(`https://izaoperfumeria.com/api/webhooks/mastershop/${SECRETO}`);
    const r = await registrarWebhooksIzao(client, url);
    expect(r).toEqual([
      { idProductWebhook: 6001, idWebhook: 16, enabled: true },
      { idProductWebhook: 6002, idWebhook: 17, enabled: true },
    ]);
    const cuerpos = mock.requests.filter((q) => q.path === '/api/webhooks').map((q) => JSON.parse(q.body!) as Record<string, unknown>);
    expect(cuerpos[0]).toEqual({ name: 'Izao Perfumeria', webhookName: 'Cambio de estado del pedido', url, idWebhook: 16, idProduct: null });
    expect(JSON.stringify(r) + inspect(r)).not.toContain(LLAVE);
  });

  it('omite los eventos ya registrados', async () => {
    const { client } = setup();
    const r = await registrarWebhooksIzao(client, urlWebhookIzao('https://izaoperfumeria.com', SECRETO), new Set([16]));
    expect(r.map((x) => x.idWebhook)).toEqual([17]);
  });

  it('valida antes de llamar: nombre con números, evento inexistente, http o secreto corto', async () => {
    const { mock, client } = setup();
    await expect(client.registerWebhook({ name: 'Izao 2', webhookName: 'x', url: 'https://a.co', idWebhook: 16 })).rejects.toThrow(/letras/);
    await expect(client.registerWebhook({ name: 'Izao', webhookName: 'x', url: 'https://a.co', idWebhook: 24 })).rejects.toThrow(/idWebhook/);
    await expect(client.registerWebhook({ name: 'Izao', webhookName: 'x', url: 'http://a.co', idWebhook: 16 })).rejects.toThrow(/https/);
    expect(() => urlWebhookIzao('https://izaoperfumeria.com', 'corto')).toThrow(/32/);
    expect(mock.requests).toHaveLength(0);
  });

  it('habilitar/deshabilitar con PUT', async () => {
    const { mock, client } = setup();
    const [w] = await registrarWebhooksIzao(client, urlWebhookIzao('https://izaoperfumeria.com', SECRETO));
    await client.setWebhookEnabled(w!.idProductWebhook, false);
    expect(mock.webhooks.get(w!.idProductWebhook)!.isEnable).toBe(false);
    await expect(client.setWebhookEnabled(999, true)).rejects.toMatchObject({ kind: 'no_encontrado' });
  });
});
