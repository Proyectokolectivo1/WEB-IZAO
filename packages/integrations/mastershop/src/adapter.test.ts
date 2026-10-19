import type { CarrierProvider } from '@izao/core/contracts';
import { describe, expect, it } from 'vitest';
import { MasterShopCarrier, UNKNOWN_STATUS_ID } from './adapter';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MASTERSHOP_CREDENTIALS, parseMasterShopCredentials } from './credentials';
import { MasterShopError } from './errors';
import { MasterShopMock } from './mock/server';
import { MS_ERRORS } from './mock/fixtures';
import { CarrierOrderError } from './order';
import { makeItem, makeOrder } from './test-utils/orders';

const KEY = 'clave-de-prueba';
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: KEY, clock });
  const client = new MasterShopClient({ apiKey: KEY, fetch: mock.fetch, clock });
  const carrier = new MasterShopCarrier({
    client,
    clock,
    resolveOrderOptions: () => ({
      mode: 'prorate',
      paymentGateway: 'wompi',
      paymentReference: 'ref-1',
    }),
    createClient: (apiKey) => new MasterShopClient({ apiKey, fetch: mock.fetch, clock }),
  });
  const provider: CarrierProvider = carrier;
  return { clock, mock, client, carrier, provider };
}

describe('MasterShopCarrier implementa CarrierProvider (§14.1)', () => {
  it('ciclo completo: crear → confirmar → etiqueta → estados', async () => {
    const { mock, provider } = setup();
    const created = await provider.createOrder(makeOrder());
    expect(created).toEqual({ providerOrderId: 1001, statusId: 1 });

    await provider.confirmOrder(created.providerOrderId);
    expect(mock.orders.get(1001)?.statusId).toBe(2);

    const noLabel = await provider.getOrder({ externalOrderId: 'IZ-CO-000123' });
    expect(noLabel).toMatchObject({
      providerOrderId: 1001,
      statusId: 2,
      labelUrl: null,
      statusParent: 'Por preparar',
    });

    mock.attachLabel(1001, '240000000001');
    mock.setStatus(1001, 4);
    const withLabel = await provider.getOrder({ providerOrderId: 1001 });
    expect(withLabel).toMatchObject({
      providerOrderId: 1001,
      externalOrderId: 'IZ-CO-000123',
      statusId: 4,
      statusName: 'Por Recolectar',
      statusParent: 'En preparación',
      trackingCode: '240000000001',
      trackingUrl: 'https://rastreo.example.com/240000000001',
      labelUrl: 'https://labels.example.com/240000000001.pdf',
      carrierName: 'Transportadora',
      hasNovelty: false,
    });
  });

  it('crear dos veces el mismo pedido no lo duplica', async () => {
    const { mock, provider } = setup();
    const a = await provider.createOrder(makeOrder());
    const b = await provider.createOrder(makeOrder());
    expect(b).toEqual(a);
    expect(mock.orders.size).toBe(1);
  });

  it('una variante sin vínculo falla antes de llamar a MasterShop', async () => {
    const { mock, provider } = setup();
    await expect(
      provider.createOrder(makeOrder({ items: [makeItem({ mastershop_product_id: null })] })),
    ).rejects.toBeInstanceOf(CarrierOrderError);
    expect(mock.requests).toHaveLength(0);
  });

  it('confirmar es idempotente si el pedido ya avanzó', async () => {
    const { mock, provider } = setup();
    const { providerOrderId } = await provider.createOrder(makeOrder());
    mock.setStatus(providerOrderId, 3);
    await expect(provider.confirmOrder(providerOrderId)).resolves.toBeUndefined();
  });

  it('confirmar un pedido cancelado falla sin reintento', async () => {
    const { mock, provider } = setup();
    const { providerOrderId } = await provider.createOrder(makeOrder());
    mock.setStatus(providerOrderId, 9);
    const e = await provider.confirmOrder(providerOrderId).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MasterShopError);
    expect((e as MasterShopError).retryable).toBe(false);
  });

  it('502 que no se aplicó deja un error reintentable por el job (estado verificado)', async () => {
    const { mock, provider } = setup();
    const { providerOrderId } = await provider.createOrder(makeOrder());
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: false });
    const e = (await provider
      .confirmOrder(providerOrderId)
      .catch((x: unknown) => x)) as MasterShopError;
    expect(e.kind).toBe('servidor');
    expect(e.retryable).toBe(true);
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
  });

  it('502 que sí se aplicó confirma sin repetir el PUT', async () => {
    const { mock, provider } = setup();
    const { providerOrderId } = await provider.createOrder(makeOrder());
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: true });
    await expect(provider.confirmOrder(providerOrderId)).resolves.toBeUndefined();
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
  });

  it('cancelar envía { idStatus: 9 } y es idempotente', async () => {
    const { mock, provider } = setup();
    const { providerOrderId } = await provider.createOrder(makeOrder());
    await provider.cancelOrder(providerOrderId);
    expect(mock.orders.get(providerOrderId)?.statusId).toBe(9);
    await expect(provider.cancelOrder(providerOrderId)).resolves.toBeUndefined();
  });

  it('cancelar un pedido en preparación falla (solo 1 o 2)', async () => {
    const { mock, provider } = setup();
    const { providerOrderId } = await provider.createOrder(makeOrder());
    mock.setStatus(providerOrderId, 3);
    const e = (await provider
      .cancelOrder(providerOrderId)
      .catch((x: unknown) => x)) as MasterShopError;
    expect(e.kind).toBe('estado_no_editable');
  });

  it('listOrders mapea a CarrierOrderSummary con montos bigint', async () => {
    const { mock, clock, provider } = setup();
    mock.seed({
      externalOrderId: 'IZ-CO-000500',
      createdAt: new Date(clock.now() - 20 * DAY),
      statusId: 8,
      shippingRate: 12_000,
      totalProvider: 50_000,
      alerts: [{ idAlert: 1, name: 'Novedad', type: 'x' }],
    });
    const rows = await provider.listOrders({
      startDate: new Date(clock.now() - 45 * DAY),
      page: 1,
    });
    expect(rows).toEqual([
      {
        providerOrderId: 1001,
        externalOrderId: 'IZ-CO-000500',
        statusId: 8,
        statusName: 'Entregada',
        statusParent: 'Finalizadas',
        hasNovelty: true,
        shippingRate: 12_000n,
        totalProvider: 50_000n,
        updatedAt: new Date(clock.now() - 20 * DAY).toISOString(),
      },
    ]);
  });

  it('un nombre de estado desconocido queda con statusId 0', async () => {
    const { mock, clock, provider } = setup();
    mock.inject('list', {
      status: 200,
      body: [{ idOrder: 5, externalOrderId: 'IZ-CO-1', orderStatus: 'Extraviada' }],
    });
    const [row] = await provider.listOrders({ startDate: new Date(clock.now() - DAY), page: 1 });
    expect(row).toMatchObject({ statusId: UNKNOWN_STATUS_ID, statusName: 'Extraviada' });
  });

  it('testCredentials con la llave correcta, incorrecta y ausente', async () => {
    const { provider } = setup();
    expect(await provider.testCredentials({ api_key: KEY })).toEqual({
      ok: true,
      message: 'Conexión con MasterShop correcta.',
    });
    expect((await provider.testCredentials({ api_key: 'mala' })).ok).toBe(false);
    expect(await provider.testCredentials({})).toEqual({
      ok: false,
      message: 'Falta la llave de API de MasterShop.',
    });
  });
});

describe('credenciales de MasterShop', () => {
  it('declara una sola llave secreta para Colombia', () => {
    expect(MASTERSHOP_CREDENTIALS.countries).toEqual(['CO']);
    expect(MASTERSHOP_CREDENTIALS.fields).toEqual([
      expect.objectContaining({ key: 'api_key', secret: true, required: true }),
    ]);
  });

  it('parse rechaza campos desconocidos o vacíos', () => {
    expect(parseMasterShopCredentials({ api_key: ' abc ' })).toEqual({ apiKey: 'abc' });
    expect(parseMasterShopCredentials({ api_key: '' })).toBeNull();
    expect(parseMasterShopCredentials({ api_key: 'a', otro: 'b' })).toBeNull();
    expect(parseMasterShopCredentials(null)).toBeNull();
  });
});
