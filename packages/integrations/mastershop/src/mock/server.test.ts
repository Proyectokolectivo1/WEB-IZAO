import { describe, expect, it } from 'vitest';
import { FakeClock } from '../clock';
import { buildCarrierOrder } from '../order';
import { serializeMasterShopJson } from '../json';
import { makeOrder } from '../test-utils/orders';
import { MasterShopMock } from './server';

const KEY = 'clave-de-prueba';
const DAY = 24 * 60 * 60 * 1000;

function setup(extra: Partial<ConstructorParameters<typeof MasterShopMock>[0]> = {}) {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: KEY, clock, ...extra });
  const call = async (method: string, path: string, body?: unknown, key = KEY) => {
    const res = await mock.fetch(`https://prod.api.mastershop.com${path}`, {
      method,
      headers: { 'ms-api-key': key, 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, json: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { clock, mock, call };
}

const validBody = () =>
  serializeMasterShopJson(
    buildCarrierOrder(makeOrder(), { mode: 'prorate', paymentGateway: 'wompi' }).body,
  );

describe('MasterShopMock reproduce las trampas documentadas', () => {
  it('sin llave → 401 "API Key requerida"', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/orders?idOrder=1', undefined, 'otra');
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ data: null, error: 'API Key requerida', success: false });
  });

  it('el listado sin filtros solo devuelve los últimos 7 días', async () => {
    const { mock, clock, call } = setup();
    mock.seed({ externalOrderId: 'IZ-CO-1', createdAt: new Date(clock.now() - 2 * DAY) });
    mock.seed({ externalOrderId: 'IZ-CO-2', createdAt: new Date(clock.now() - 10 * DAY) });
    const noFilter = await call('POST', '/api/orders/list?page=1&limit=50', {});
    expect(noFilter.json.map((o: { externalOrderId: string }) => o.externalOrderId)).toEqual([
      'IZ-CO-1',
    ]);
    const withStart = await call('POST', '/api/orders/list?page=1&limit=50', {
      startDate: new Date(clock.now() - 45 * DAY).toISOString(),
    });
    expect(withStart.json).toHaveLength(2);
  });

  it('limit > 50 se recorta en silencio a 50', async () => {
    const { mock, clock, call } = setup();
    for (let i = 0; i < 80; i++) {
      mock.seed({ externalOrderId: `IZ-CO-${i}`, createdAt: new Date(clock.now() - i * 1000) });
    }
    const r = await call('POST', '/api/orders/list?page=1&limit=100', {});
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(50);
  });

  it('crear dos veces el mismo id_order → 500 "Código 409 - La orden ya existe"', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/orders', validBody())).status).toBe(200);
    const again = await call('POST', '/api/orders', validBody());
    expect(again.status).toBe(500);
    expect(again.json.error).toMatch(/409 - La orden ya existe/);
  });

  it('externalOrderId con guion bajo no se puede consultar', async () => {
    const { call } = setup();
    const r = await call('GET', '/api/orders?externalOrderId=IZ_CO_1');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Datos de los parámetros inválidos');
  });

  it('rechaza un pedido sin las claves que admiten null (company, zip, address2)', async () => {
    const { call } = setup();
    const body = JSON.parse(validBody());
    delete body.shipping_address.company;
    delete body.billing_address.zip;
    const r = await call('POST', '/api/orders', body);
    expect(r.status).toBe(400);
    expect(r.json.data).toEqual(
      expect.arrayContaining([
        { path: 'shipping_address.company', message: 'Requerido' },
        { path: 'billing_address.zip', message: 'Requerido' },
      ]),
    );
  });

  it('rechaza un total que no cuadra por 1 peso', async () => {
    const { call } = setup();
    const body = JSON.parse(validBody());
    body.order_transaction.total += 1;
    const r = await call('POST', '/api/orders', body);
    expect(r.status).toBe(400);
    expect(r.json.data).toBeNull();
  });

  it('rechaza documento a medias y moneda no legal', async () => {
    const { call } = setup();
    const a = JSON.parse(validBody());
    a.customer.documentNumber = null;
    expect((await call('POST', '/api/orders', a)).status).toBe(400);
    const b = JSON.parse(validBody());
    b.order_transaction.currency = 'USD';
    expect((await call('POST', '/api/orders', b)).status).toBe(400);
  });

  it('PUT solo permite 1→2, 1→9 y 2→9; lo demás es 409', async () => {
    const { mock, call } = setup();
    const created = await call('POST', '/api/orders', validBody());
    const id = created.json.idOrder as number;
    expect((await call('PUT', `/api/orders/${id}`, { idStatus: 2 })).status).toBe(200);
    expect(mock.orders.get(id)?.statusId).toBe(2);
    expect((await call('PUT', `/api/orders/${id}`, { idStatus: 2 })).status).toBe(409);
    expect((await call('PUT', `/api/orders/${id}`, { idStatus: 9 })).status).toBe(200);
    expect((await call('PUT', `/api/orders/${id}`, { idStatus: 9 })).status).toBe(409);
  });

  it('PUT con claves no permitidas → 400', async () => {
    const { call } = setup();
    const created = await call('POST', '/api/orders', validBody());
    const r = await call('PUT', `/api/orders/${created.json.idOrder}`, { orderItems: [] });
    expect(r.status).toBe(400);
  });

  it('PUT 502 que sí se aplicó y 502 que no', async () => {
    const { mock, call } = setup();
    const created = await call('POST', '/api/orders', validBody());
    const id = created.json.idOrder as number;
    mock.inject('update', { status: 502, body: { error: 'x' }, apply: false });
    expect((await call('PUT', `/api/orders/${id}`, { idStatus: 2 })).status).toBe(502);
    expect(mock.orders.get(id)?.statusId).toBe(1);
    mock.inject('update', { status: 502, body: { error: 'x' }, apply: true });
    expect((await call('PUT', `/api/orders/${id}`, { idStatus: 2 })).status).toBe(502);
    expect(mock.orders.get(id)?.statusId).toBe(2);
  });

  it('cabeceras RateLimit-* y 429 al agotar la ventana; se reinicia con el reloj', async () => {
    const { clock, call } = setup({ rateLimit: { limit: 2, windowSeconds: 60 } });
    const a = await call('GET', '/api/products?page=1');
    expect(a.headers.get('RateLimit-Limit')).toBe('2');
    expect(a.headers.get('RateLimit-Remaining')).toBe('1');
    expect(a.headers.get('RateLimit-Reset')).toBe('60');
    await call('GET', '/api/products?page=1');
    clock.advance(15_000);
    const c = await call('GET', '/api/products?page=1');
    expect(c.status).toBe(429);
    expect(c.headers.get('RateLimit-Reset')).toBe('45');
    expect(c.json).toEqual({ error: 'Demasiadas solicitudes, intenta de nuevo más tarde' });
    clock.advance(45_000);
    expect((await call('GET', '/api/products?page=1')).status).toBe(200);
  });
});
