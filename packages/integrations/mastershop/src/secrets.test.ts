import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MasterShopCarrier } from './adapter';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MasterShopError } from './errors';
import { MasterShopMock } from './mock/server';
import { MS_ERRORS } from './mock/fixtures';
import { makeOrder } from './test-utils/orders';

// Llave ficticia con forma reconocible: si aparece en cualquier salida, la prueba falla.
const KEY = 'ms_live_SECRETO_0123456789abcdef';

function leaks(value: unknown): boolean {
  const outputs = [
    JSON.stringify(value) ?? '',
    inspect(value, { depth: 10, showHidden: true, getters: true }),
    String(value),
  ];
  return outputs.some((o) => o.includes(KEY) || o.includes('SECRETO'));
}

function setup() {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: KEY, clock });
  const client = new MasterShopClient({ apiKey: KEY, fetch: mock.fetch, clock });
  const carrier = new MasterShopCarrier({
    client,
    clock,
    resolveOrderOptions: () => ({ mode: 'prorate', paymentGateway: 'wompi' }),
  });
  return { mock, client, carrier };
}

describe('la ms-api-key nunca aparece en logs (M5)', () => {
  it('ni el cliente ni el adaptador la exponen con JSON.stringify, inspect o String', () => {
    const { client, carrier } = setup();
    expect(leaks(client)).toBe(false);
    expect(leaks(carrier)).toBe(false);
    expect(leaks({ contexto: { client, carrier } })).toBe(false);
  });

  it('la llave no es una propiedad enumerable ni accesible', () => {
    const { client } = setup();
    expect(Object.keys(client).join(',')).not.toMatch(/apiKey/i);
    expect((client as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    expect(JSON.parse(JSON.stringify(client))).toEqual({
      baseUrl: 'https://prod.api.mastershop.com',
      apiKey: '[REDACTADO]',
    });
  });

  it('los MasterShopError de llamadas fallidas no la incluyen', async () => {
    const { mock, client, carrier } = setup();
    const errors: unknown[] = [];
    mock.inject('create', { status: 500, body: MS_ERRORS.internal });
    await carrier.createOrder(makeOrder()).catch((e: unknown) => errors.push(e));
    await client.getOrder({ idOrder: 999 }).catch((e: unknown) => errors.push(e));
    const failing = new MasterShopClient({
      apiKey: KEY,
      clock: new FakeClock(),
      fetch: () => Promise.reject(new TypeError(`fetch failed`)),
    });
    await failing.getOrder({ idOrder: 1 }).catch((e: unknown) => errors.push(e));
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      expect(e).toBeInstanceOf(MasterShopError);
      expect(leaks(e)).toBe(false);
    }
  });

  it('un MasterShopError cuyo proveedor devuelva la llave (p. ej. configWebhook.apiKey) la redacta', () => {
    const e = new MasterShopError({
      kind: 'validacion',
      message: 'x',
      providerMessage: `llave ${KEY}`,
      providerData: { configWebhook: { apiKey: KEY, name: 'Notificacion' } },
      secrets: [KEY],
    });
    expect(leaks(e)).toBe(false);
    expect(e.providerMessage).toBe('llave [REDACTADO]');
    expect(e.providerData).toEqual({
      configWebhook: { apiKey: '[REDACTADO]', name: 'Notificacion' },
    });
  });

  it('el cliente redacta su llave en los errores aunque el proveedor la repita', async () => {
    const { mock, client } = setup();
    mock.inject('get', {
      status: 400,
      body: { data: { configWebhook: { apiKey: KEY } }, error: `mala ${KEY}`, success: false },
    });
    const e = await client.getOrder({ idOrder: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MasterShopError);
    expect(leaks(e)).toBe(false);
  });
});
