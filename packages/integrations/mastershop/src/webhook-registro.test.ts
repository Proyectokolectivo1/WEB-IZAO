import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MasterShopMock } from './mock';
import { registrarWebhooksIzao, urlWebhookIzao, type AlmacenWebhooks, type WebhookGuardado } from './webhook-registro';

const LLAVE = 'ms-llave-secreta-webhooks-0001';
const SECRETO = 's'.repeat(40);

function setup() {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: LLAVE, clock });
  const guardados: WebhookGuardado[] = [];
  const almacen: AlmacenWebhooks = {
    registrados: async () => new Set(guardados.map((g) => g.idWebhook)),
    guardar: async (w) => void guardados.push(w),
  };
  return { mock, guardados, almacen, client: new MasterShopClient({ apiKey: LLAVE, fetch: mock.fetch, clock }) };
}

describe('registro de webhooks de MasterShop', () => {
  it('registra 16 y 17 con idProduct null y guarda los idProductWebhook, sin la llave que repite la respuesta', async () => {
    const { mock, client, almacen, guardados } = setup();
    const url = urlWebhookIzao('https://izaoperfumeria.com/co', SECRETO);
    expect(url).toBe(`https://izaoperfumeria.com/api/webhooks/mastershop/${SECRETO}`);
    const r = await registrarWebhooksIzao(client, url, almacen);
    expect(guardados).toEqual([
      { idProductWebhook: 6001, idWebhook: 16, enabled: true, eventName: 'Cambio de estado del pedido' },
      { idProductWebhook: 6002, idWebhook: 17, enabled: true, eventName: 'Cambio de estado de la transportadora' },
    ]);
    expect(r).toEqual(guardados);
    const cuerpos = mock.requests.filter((q) => q.path === '/api/webhooks').map((q) => JSON.parse(q.body!) as Record<string, unknown>);
    expect(cuerpos[0]).toEqual({ name: 'Izao Perfumeria', webhookName: 'Cambio de estado del pedido', url, idWebhook: 16, idProduct: null });
    expect(JSON.stringify(guardados) + inspect(guardados)).not.toContain(LLAVE);
    expect(JSON.stringify(guardados)).not.toContain(SECRETO);
  });

  it('idempotente: un segundo clic no registra nada; si falló el 17, solo registra el 17', async () => {
    const { mock, client, almacen, guardados } = setup();
    const url = urlWebhookIzao('https://izaoperfumeria.com', SECRETO);
    mock.inject('webhook_create', { status: 200, body: {} }); // 16 responde algo inválido
    await expect(registrarWebhooksIzao(client, url, almacen)).rejects.toThrow();
    expect(guardados).toEqual([]);
    await registrarWebhooksIzao(client, url, almacen);
    expect(await registrarWebhooksIzao(client, url, almacen)).toEqual([]);
    expect(guardados.map((g) => g.idWebhook)).toEqual([16, 17]);
    guardados.pop();
    expect((await registrarWebhooksIzao(client, url, almacen)).map((g) => g.idWebhook)).toEqual([17]);
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
    const { mock, client, almacen } = setup();
    const [w] = await registrarWebhooksIzao(client, urlWebhookIzao('https://izaoperfumeria.com', SECRETO), almacen);
    await client.setWebhookEnabled(w!.idProductWebhook, false);
    expect(mock.webhooks.get(w!.idProductWebhook)!.isEnable).toBe(false);
    await expect(client.setWebhookEnabled(999, true)).rejects.toMatchObject({ kind: 'no_encontrado' });
  });
});
