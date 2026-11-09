import { describe, expect, it } from 'vitest';
import { MasterShopClient } from './client';
import { FakeClock } from './clock';
import { MasterShopError } from './errors';
import { MasterShopMock } from './mock/server';
import { MS_ERRORS } from './mock/fixtures';
import { buildCarrierOrder } from './order';
import { makeItem, makeOrder, makeOrderEC } from './test-utils/orders';

const KEY = 'clave-de-prueba';
const DAY = 24 * 60 * 60 * 1000;

function setup(mockExtra: Partial<ConstructorParameters<typeof MasterShopMock>[0]> = {}) {
  const clock = new FakeClock();
  const mock = new MasterShopMock({ apiKey: KEY, clock, ...mockExtra });
  const client = new MasterShopClient({ apiKey: KEY, fetch: mock.fetch, clock });
  return { clock, mock, client };
}

const body = (
  overrides: Parameters<typeof makeOrder>[0] = {},
  mode: 'prorate' | 'additional_charge' = 'prorate',
) =>
  buildCarrierOrder(makeOrder(overrides), {
    mode,
    paymentGateway: 'wompi',
    paymentReference: 'ref-1',
  }).body;

async function expectError(
  p: Promise<unknown>,
  kind: MasterShopError['kind'],
): Promise<MasterShopError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(MasterShopError);
    expect((e as MasterShopError).kind).toBe(kind);
    return e as MasterShopError;
  }
  throw new Error(`se esperaba MasterShopError ${kind}`);
}

describe('MasterShopClient.createOrder', () => {
  it('envía el cuerpo con montos enteros exactos y la cabecera ms-api-key', async () => {
    const { mock, client } = setup();
    const r = await client.createOrder(
      body({
        items: [
          makeItem({ sku: 'A', unit_price: 90_000n, line_discount: 9_000n }),
          makeItem({ id: 'i2', sku: 'B', unit_price: 60_000n, line_discount: 6_000n }),
        ],
      }),
    );
    expect(r).toEqual({
      idOrder: 1001,
      externalOrderId: 'IZ-CO-000123',
      statusName: 'Por Confirmar',
      duplicated: false,
    });
    const req = mock.requests.at(-1)!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/api/orders');
    expect(req.headers['ms-api-key']).toBe(KEY);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body).toContain('"total":125000');
    expect(req.body).toContain('"price":75000');
    expect(req.body).toContain('"price":50000');
    expect(req.body).not.toContain('"125000"');
  });

  it('el modo A con additional_charge negativo cuadra exacto en el mock (solo si se habilita; producción lo rechaza)', async () => {
    const { mock, client } = setup({ acceptNegativeCharges: true });
    await client.createOrder(
      body(
        {
          items: [
            makeItem({ sku: 'A', unit_price: 90_000n, line_discount: 9_000n }),
            makeItem({ id: 'i2', sku: 'B', unit_price: 60_000n, line_discount: 6_000n }),
          ],
        },
        'additional_charge',
      ),
    );
    expect(mock.requests.at(-1)!.body).toContain(
      '"additional_charge":[{"type_charge":"descuento","value":-25000}]',
    );
  });

  it('500 "409 - La orden ya existe" se trata como creado y consulta por externalOrderId', async () => {
    const { mock, client } = setup();
    const first = await client.createOrder(body());
    const again = await client.createOrder(body());
    expect(again).toEqual({
      idOrder: first.idOrder,
      externalOrderId: 'IZ-CO-000123',
      statusName: null,
      duplicated: true,
    });
    expect(mock.orders.size).toBe(1);
    const get = mock.requests.at(-1)!;
    expect(get.method).toBe('GET');
    expect(get.query).toEqual({ externalOrderId: 'IZ-CO-000123' });
  });

  it('otro 500 es reintentable y conserva el mensaje del proveedor', async () => {
    const { mock, client } = setup();
    mock.inject('create', { status: 500, body: MS_ERRORS.internal });
    const e = await expectError(client.createOrder(body()), 'servidor');
    expect(e.retryable).toBe(true);
    expect(e.providerMessage).toBe('Error interno del servidor');
  });

  it('additional_charge negativo: 400 "Datos del body inválidos" como en producción, sin reintento (D-043)', async () => {
    const { client } = setup();
    const e = await expectError(
      client.createOrder(
        body({ items: [makeItem({ line_discount: 9_000n })] }, 'additional_charge'),
      ),
      'validacion',
    );
    expect(e.status).toBe(400);
    expect(e.retryable).toBe(false);
    expect(e.providerMessage).toBe('Datos del body inválidos');
    expect(JSON.stringify(e.providerData)).toMatch(/additional_charge.*value/);
  });

  it('el detalle sin guía trae carrierTracking vacío y no falla (D-043)', async () => {
    const { client } = setup();
    const r = await client.createOrder(body());
    const d = await client.getOrder({ idOrder: r.idOrder });
    expect(d.guide).toBeNull();
    expect(d.labelUrl).toBeNull();
    expect((d.raw as { orderLogistics: { carrierTracking: object } }).orderLogistics.carrierTracking).toEqual({});
  });

  it.each([
    ['Código 422 - Destino no cubierto - Error interno del servidor', 'validacion', false],
    ['Código 404 - Producto no existe - Error interno del servidor', 'validacion', false],
    ['Código 503 - Servicio no disponible - Error interno del servidor', 'servidor', true],
    ['Error interno del servidor', 'servidor', true],
  ] as const)('500 "%s" → %s', async (error, kind, retryable) => {
    const { mock, client } = setup();
    mock.inject('create', { status: 500, body: { data: null, error, success: false } });
    const e = await expectError(client.createOrder(body()), kind);
    expect(e.retryable).toBe(retryable);
  });

  it('400 de validación no es reintentable', async () => {
    const { mock, client } = setup();
    mock.inject('create', {
      status: 400,
      body: { data: null, error: MS_ERRORS.totalMismatch, success: false },
    });
    const e = await expectError(client.createOrder(body()), 'validacion');
    expect(e.retryable).toBe(false);
  });

  it('no envía un cuerpo que no cumple el esquema', async () => {
    const { mock, client } = setup();
    const b = body();
    const bad = {
      ...b,
      order_transaction: { ...b.order_transaction, total: b.order_transaction.total + 1n },
    };
    await expectError(client.createOrder(bad), 'validacion');
    expect(mock.requests).toHaveLength(0);
  });

  it('401 → autenticación, no reintentable', async () => {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: KEY, clock });
    const client = new MasterShopClient({ apiKey: 'otra', fetch: mock.fetch, clock });
    const e = await expectError(client.createOrder(body()), 'autenticacion');
    expect(e.retryable).toBe(false);
  });

  it('fallo de red y tiempo agotado son reintentables', async () => {
    const clock = new FakeClock();
    const down = new MasterShopClient({
      apiKey: KEY,
      clock,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect((await expectError(down.createOrder(body()), 'red')).retryable).toBe(true);
    const slow = new MasterShopClient({
      apiKey: KEY,
      clock,
      fetch: () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    });
    expect((await expectError(slow.createOrder(body()), 'tiempo_agotado')).retryable).toBe(true);
  });

  it('pasa una señal de tiempo de espera a fetch', async () => {
    let signal: AbortSignal | null | undefined;
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: KEY, clock });
    const client = new MasterShopClient({
      apiKey: KEY,
      clock,
      fetch: (input, init) => {
        signal = init?.signal;
        return mock.fetch(input, init);
      },
    });
    await client.createOrder(body());
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('MasterShopClient.getOrder', () => {
  it('devuelve guía, rastreo y shippingLabel', async () => {
    const { mock, client } = setup();
    const { idOrder } = await client.createOrder(body());
    const before = await client.getOrder({ externalOrderId: 'IZ-CO-000123' });
    expect(before).toMatchObject({ idOrder, guide: null, labelUrl: null, statusId: null });
    mock.attachLabel(idOrder, '240000000001');
    const after = await client.getOrder({ idOrder });
    expect(after).toMatchObject({
      idOrder,
      externalOrderId: 'IZ-CO-000123',
      guide: '240000000001',
      trackingCode: '240000000001',
      trackingUrl: 'https://rastreo.example.com/240000000001',
      labelUrl: 'https://labels.example.com/240000000001.pdf',
    });
  });

  it('rechaza externalOrderId con guion bajo sin llamar a la API', async () => {
    const { mock, client } = setup();
    await expectError(client.getOrder({ externalOrderId: 'IZ_CO_1' }), 'validacion');
    await expectError(client.getOrder({}), 'validacion');
    expect(mock.requests).toHaveLength(0);
  });

  it('404 → no encontrado', async () => {
    const { client } = setup();
    await expectError(client.getOrder({ idOrder: 999 }), 'no_encontrado');
  });
});

describe('MasterShopClient.listOrders / listAllOrders', () => {
  it('siempre envía startDate y limit ≤ 50', async () => {
    const { mock, clock, client } = setup();
    await client.listOrders({ startDate: new Date(clock.now() - 45 * DAY), page: 1, limit: 500 });
    const req = mock.requests.at(-1)!;
    expect(req.query).toEqual({ page: '1', limit: '50' });
    expect(JSON.parse(req.body!)).toEqual({
      startDate: new Date(clock.now() - 45 * DAY).toISOString(),
    });
  });

  it('sin startDate no llama a la API', async () => {
    const { mock, client } = setup();
    await expectError(client.listOrders({ startDate: new Date('x'), page: 1 }), 'validacion');
    expect(mock.requests).toHaveLength(0);
  });

  it('pagina hasta una respuesta vacía (no se detiene en la página corta) y ve pedidos de más de 7 días', async () => {
    const { mock, clock, client } = setup();
    for (let i = 0; i < 120; i++) {
      mock.seed({
        externalOrderId: `IZ-CO-${String(i).padStart(6, '0')}`,
        createdAt: new Date(clock.now() - i * 6 * 60 * 60 * 1000),
      });
    }
    const all = await client.listAllOrders({ startDate: new Date(clock.now() - 45 * DAY) });
    expect(all).toHaveLength(120);
    expect(new Set(all.map((o) => o.idOrder)).size).toBe(120);
    // 50 + 50 + 20 + [] → 4 solicitudes.
    expect(mock.countRequests('POST', '/api/orders/list')).toBe(4);
  });

  it('mapea estado, grupo, novedad y montos a bigint', async () => {
    const { mock, clock, client } = setup();
    const o = mock.seed({
      externalOrderId: 'IZ-CO-000777',
      createdAt: new Date(clock.now() - DAY),
      statusId: 6,
      hasNovelty: true,
      alerts: [{ idAlert: 3, name: 'Dirección incompleta', type: 'novedad' }],
      shippingRate: 12_000,
      totalProvider: 50_000,
      totalOrder: 89_900,
    });
    const [row] = await client.listOrders({ startDate: new Date(clock.now() - 45 * DAY), page: 1 });
    expect(row).toMatchObject({
      idOrder: o.idOrder,
      externalOrderId: 'IZ-CO-000777',
      statusName: 'En tránsito',
      statusParent: 'En tránsito',
      statusId: 6,
      hasNovelty: true,
      alerts: [{ idAlert: 3, name: 'Dirección incompleta', type: 'novedad' }],
      shippingRate: 12_000n,
      totalProvider: 50_000n,
      totalOrder: 89_900n,
    });
  });

  it('acepta la forma real de producción: hasNovelty 0/1 numérico y carrierTrackingCode vacío (D-042)', async () => {
    const { mock, clock, client } = setup();
    // Claves y tipos tomados de la sonda real del 2026-11-04 (valores ficticios).
    const fila = (idOrder: number, hasNovelty: number) => ({
      idOrder,
      externalOrderId: `IZ-CO-00000${idOrder}`,
      profileType: 'dropshipping',
      carrierTrackingCode: '',
      items: [{ name: 'Producto de prueba' }],
      lastCarrierStatusUpdate: null,
      lastShipmentStatusUpdate: null,
      clientInfo: { city: 'Medellin', phone: '3000000000', state: 'Antioquia', address: 'Calle 1 2', district: null, fullName: 'Cliente Prueba' },
      paymentMethod: 'cod',
      totalOrder: 89900,
      totalProvider: 50000,
      shippingRate: 12000,
      currency: 'COP',
      orderStatus: 'Por confirmar',
      statusParent: 'Por preparar',
      carrierName: 'Transportadora',
      createdAt: '2026-11-01T15:00:00.000Z',
      shipmentDate: null,
      hasNovelty,
    });
    mock.inject('list', { status: 200, body: [fila(1, 0), fila(2, 1)] });
    const rows = await client.listOrders({ startDate: new Date(clock.now() - DAY), page: 1 });
    expect(rows.map((r) => [r.idOrder, r.hasNovelty, r.trackingCode, r.statusId])).toEqual([
      [1, false, null, 1],
      [2, true, null, 1],
    ]);
  });

  it('los listados usan listTimeoutMs (producción tarda ~13 s), las demás llamadas timeoutMs (D-042)', async () => {
    const lento: typeof fetch = (_input, init) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response('[]', { status: 200 })), 60);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('abortado'), { name: 'TimeoutError' }));
        });
      });
    const client = new MasterShopClient({ apiKey: KEY, fetch: lento, timeoutMs: 20, listTimeoutMs: 1_000 });
    await expect(client.listOrders({ startDate: new Date(Date.now() - DAY), page: 1 })).resolves.toEqual([]);
    await expect(client.listWalletMovements({ startDate: new Date(Date.now() - DAY), page: 1 })).resolves.toMatchObject({ filas: 0 });
    await expectError(client.getOrder({ idOrder: 1 }), 'tiempo_agotado');
  });

  it('un monto con decimales no tumba el listado: exacto si los decimales son cero, si no null con aviso (M6)', async () => {
    const { mock, clock, client } = setup();
    mock.inject('list', {
      status: 200,
      body: [
        { idOrder: 1, orderStatus: 'Pendiente', shippingRate: '12000.00', totalProvider: 50000 },
        { idOrder: 2, orderStatus: 'Pendiente', shippingRate: 12000.5, totalOrder: '89.900' },
        { idOrder: 3, orderStatus: 'Pendiente', shippingRate: 1e21, totalProvider: 'gratis' },
      ],
    });
    const rows = await client.listOrders({ startDate: new Date(clock.now() - DAY), page: 1 });
    expect(rows.map((r) => r.idOrder)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ shippingRate: 12_000n, totalProvider: 50_000n, warnings: [] });
    expect(rows[1]).toMatchObject({ shippingRate: null, totalOrder: null });
    expect(rows[1]!.warnings).toEqual([
      { code: 'monto_no_entero', field: 'shippingRate', value: '12000.5' },
      { code: 'monto_no_entero', field: 'totalOrder', value: '89.900' },
    ]);
    expect(rows[2]).toMatchObject({ shippingRate: null, totalProvider: null });
    expect(rows[2]!.warnings.map((w) => w.field)).toEqual(['shippingRate', 'totalProvider']);
  });
});

describe('MasterShopClient.findOrderSummary', () => {
  it('encuentra un pedido de hace 200 días filtrando solo por idOrder o externalOrderId', async () => {
    const { mock, clock, client } = setup();
    const old = mock.seed({
      externalOrderId: 'IZ-CO-000001',
      createdAt: new Date(clock.now() - 200 * DAY),
      statusId: 8,
    });
    expect(await client.findOrderSummary({ idOrder: old.idOrder })).toMatchObject({
      idOrder: old.idOrder,
      statusId: 8,
    });
    expect(JSON.parse(mock.requests.at(-1)!.body!)).toEqual({ idOrder: old.idOrder });
    expect(await client.findOrderSummary({ externalOrderId: 'IZ-CO-000001' })).toMatchObject({
      idOrder: old.idOrder,
    });
    expect(JSON.parse(mock.requests.at(-1)!.body!)).toEqual({ externalOrderId: 'IZ-CO-000001' });
  });

  it('exige al menos un identificador', async () => {
    const { mock, client } = setup();
    await expectError(client.findOrderSummary({}), 'validacion');
    expect(mock.requests).toHaveLength(0);
  });
});

describe('MasterShopClient.updateOrderStatus (confirmar y cancelar)', () => {
  async function created() {
    const s = setup();
    const { idOrder } = await s.client.createOrder(body());
    return { ...s, idOrder };
  }

  it('confirma con exactamente { idStatus: 2 } y cancela con exactamente { idStatus: 9 }', async () => {
    const { mock, client, idOrder } = await created();
    expect(await client.updateOrderStatus(idOrder, 2)).toEqual({
      applied: true,
      statusId: 2,
      via: 'respuesta',
    });
    expect(mock.requests.at(-1)!.body).toBe('{"idStatus":2}');
    expect(await client.updateOrderStatus(idOrder, 9)).toEqual({
      applied: true,
      statusId: 9,
      via: 'respuesta',
    });
    expect(mock.requests.at(-1)!.body).toBe('{"idStatus":9}');
    expect(mock.requests.at(-1)!.path).toBe(`/api/orders/${idOrder}`);
  });

  it('409 por edición concurrente → reintenta a los 5 s', async () => {
    const { mock, clock, client, idOrder } = await created();
    mock.inject('update', { status: 409, body: MS_ERRORS.concurrentEdit });
    const t0 = clock.now();
    expect(await client.updateOrderStatus(idOrder, 2)).toMatchObject({ applied: true });
    expect(clock.sleeps).toEqual([5_000]);
    expect(clock.now() - t0).toBe(5_000);
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(2);
  });

  it('409 concurrente persistente → se rinde tras 3 reintentos, reintentable por el job', async () => {
    const { mock, clock, client, idOrder } = await created();
    for (let i = 0; i < 4; i++)
      mock.inject('update', { status: 409, body: MS_ERRORS.concurrentEdit });
    const e = await expectError(client.updateOrderStatus(idOrder, 2), 'edicion_concurrente');
    expect(e.retryable).toBe(true);
    expect(clock.sleeps).toEqual([5_000, 5_000, 5_000]);
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(4);
  });

  it('409 por estado no editable no se reintenta', async () => {
    const { mock, clock, client, idOrder } = await created();
    mock.setStatus(idOrder, 3);
    const e = await expectError(client.updateOrderStatus(idOrder, 9), 'estado_no_editable');
    expect(e.retryable).toBe(false);
    expect(clock.sleeps).toEqual([]);
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
  });

  it('502 que sí se aplicó: no reintenta el PUT, consulta y reporta aplicado', async () => {
    const { mock, client, idOrder } = await created();
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: true });
    expect(await client.updateOrderStatus(idOrder, 2)).toEqual({
      applied: true,
      statusId: 2,
      via: 'consulta',
    });
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
    const list = mock.requests.at(-1)!;
    expect(list.path).toBe('/api/orders/list');
    // Un filtro cualquiera quita la ventana de 7 días: basta idOrder.
    expect(JSON.parse(list.body!)).toEqual({ idOrder });
  });

  it('502 que no se aplicó: no reintenta y reporta el estado real', async () => {
    const { mock, client, idOrder } = await created();
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: false });
    expect(await client.updateOrderStatus(idOrder, 2)).toEqual({
      applied: false,
      statusId: 1,
      via: 'consulta',
    });
    expect(mock.countRequests('PUT', '/api/orders/')).toBe(1);
  });

  it('502 al confirmar cuando el pedido ya avanzó a 3 cuenta como aplicado', async () => {
    const { mock, client, idOrder } = await created();
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed, apply: false });
    mock.setStatus(idOrder, 3);
    expect(await client.updateOrderStatus(idOrder, 2)).toEqual({
      applied: true,
      statusId: 3,
      via: 'consulta',
    });
  });

  it('502 y el pedido no aparece en la consulta → no_confirmado, no reintentable', async () => {
    const { mock, client, idOrder } = await created();
    mock.inject('update', { status: 502, body: MS_ERRORS.notConfirmed });
    mock.inject('list', { status: 200, body: [] });
    const e = await expectError(client.updateOrderStatus(idOrder, 2), 'no_confirmado');
    expect(e.retryable).toBe(false);
  });

  it('422 → rechazado', async () => {
    const { mock, client, idOrder } = await created();
    mock.inject('update', { status: 422, body: MS_ERRORS.rejected });
    await expectError(client.updateOrderStatus(idOrder, 2), 'rechazado');
  });
});

describe('MasterShopClient y RateLimit-*', () => {
  it('en 429 espera RateLimit-Reset y reintenta', async () => {
    const { clock, client, mock } = setup({ rateLimit: { limit: 1, windowSeconds: 60 } });
    // Una solicitud por fuera del cliente agota la ventana.
    await mock.fetch('https://prod.api.mastershop.com/api/products', {
      headers: { 'ms-api-key': KEY },
    });
    clock.advance(20_000);
    expect(await client.testCredentials()).toEqual({
      ok: true,
      message: 'Conexión con MasterShop correcta.',
    });
    expect(clock.sleeps).toEqual([40_000]);
  });

  it('con Remaining 0 espera el reinicio antes de la siguiente solicitud (sin provocar 429)', async () => {
    const { clock, client, mock } = setup({ rateLimit: { limit: 2, windowSeconds: 30 } });
    await client.testCredentials();
    await client.testCredentials(); // Remaining 0, Reset 30
    await client.testCredentials();
    expect(clock.sleeps).toEqual([30_000]);
    expect(mock.requests.every((r) => r.path === '/api/products')).toBe(true);
    expect(mock.requests).toHaveLength(3);
  });

  it('429 persistente → error de límite con la espera sugerida', async () => {
    const { client, mock } = setup();
    for (let i = 0; i < 3; i++) {
      mock.inject('products', {
        status: 429,
        body: MS_ERRORS.tooManyRequests,
        headers: { 'RateLimit-Reset': '17' },
      });
    }
    // testCredentials no lanza: devuelve el mensaje.
    expect(await client.testCredentials()).toEqual({
      ok: false,
      message: 'Se alcanzó el límite de solicitudes de MasterShop.',
    });
    for (let i = 0; i < 3; i++) {
      mock.inject('get', {
        status: 429,
        body: MS_ERRORS.tooManyRequests,
        headers: { 'RateLimit-Reset': '17' },
      });
    }
    const e = await expectError(client.getOrder({ idOrder: 1 }), 'limite');
    expect(e.retryAfterMs).toBe(17_000);
    expect(e.retryable).toBe(true);
  });
});

describe('MasterShopClient.testCredentials', () => {
  it('llave inválida → ok false con mensaje amable', async () => {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: KEY, clock });
    const client = new MasterShopClient({ apiKey: 'mala', fetch: mock.fetch, clock });
    expect(await client.testCredentials()).toEqual({
      ok: false,
      message: 'La llave de API de MasterShop no es válida o no tiene permiso.',
    });
  });
});

describe('Ecuador: llave propia en USD (D-052)', () => {
  function setupEC() {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: 'llave-ec', clock, currency: 'USD' });
    const client = new MasterShopClient({ apiKey: 'llave-ec', fetch: mock.fetch, clock, currency: 'USD' });
    return { clock, mock, client };
  }
  const opts = { mode: 'prorate' as const, paymentGateway: 'wompi', paymentReference: 'ref-ec' };

  it('crea el pedido con total decimal exacto (cuadra en el mock con igualdad decimal)', async () => {
    const { mock, client } = setupEC();
    const items = [
      makeItem({ sku: 'A', unit_price: 1_999n, quantity: 3, mastershop_product_id: 7001 }),
      makeItem({ id: 'i2', sku: 'B', unit_price: 4_990n, line_discount: 499n, mastershop_product_id: 7002 }),
    ];
    const r = await client.createOrder(buildCarrierOrder(makeOrderEC({ items, payment_method: 'wompi' }), opts).body);
    expect(r.duplicated).toBe(false);
    const sent = mock.findByExternalId('IZ-EC-000045')!.rawBody;
    expect(sent).toContain('"currency":"USD"');
    expect(sent).toContain('"total":104.88');
    expect(mock.findByExternalId('IZ-EC-000045')?.totalOrder).toBe(104.88);
  });

  it('el mock rechaza un total calculado en coma flotante (1.1 × 3 = 3.3000000000000003) como MasterShop', async () => {
    const { mock } = setupEC();
    const cuerpo = buildCarrierOrder(makeOrderEC({ items: [makeItem({ unit_price: 110n, quantity: 3, mastershop_product_id: 7001 })], payment_method: 'wompi' }), opts).body;
    const json = JSON.stringify({ ...cuerpo, order_items: cuerpo.order_items.map((i) => ({ ...i, price: 1.1 })), order_transaction: { ...cuerpo.order_transaction, total: 1.1 * 3 } });
    const res = await mock.fetch('https://prod.api.mastershop.com/api/orders', {
      method: 'POST',
      headers: { 'ms-api-key': 'llave-ec', 'content-type': 'application/json' },
      body: json,
    });
    expect(res.status).toBe(400);
  });

  it('lee montos del listado y de la billetera en centavos', async () => {
    const { mock, clock, client } = setupEC();
    mock.inject('list', {
      status: 200,
      body: [{ idOrder: 1, orderStatus: 'Pendiente', shippingRate: 4.5, totalProvider: '12.00', totalOrder: '1.234' }],
    });
    const [row] = await client.listOrders({ startDate: new Date(clock.now() - DAY), page: 1 });
    expect(row).toMatchObject({ shippingRate: 450n, totalProvider: 1_200n, totalOrder: null });
    mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -4.75, balanceMovementDate: new Date(clock.now() - 1_000), idOrder: 1, newBalance: 95.25 });
    const w = await client.listWalletMovements({ startDate: new Date(clock.now() - DAY), page: 1 });
    expect(w.movimientos[0]).toMatchObject({ moneda: 'USD', valor: -475n, saldoNuevo: 9_525n });
  });

  it('billetera: un monto con más de 2 decimales queda fuera con aviso (no se redondea)', async () => {
    const { mock, clock, client } = setupEC();
    const raro = mock.seedMovement({ movementType: 'Cobro por Envío', movementValue: -4.751, balanceMovementDate: new Date(clock.now() - 1_000), idOrder: 1 });
    const w = await client.listWalletMovements({ startDate: new Date(clock.now() - DAY), page: 1 });
    expect(w.movimientos).toEqual([]);
    expect(w.avisos).toEqual([{ idBalanceMovement: raro.idBalanceMovement, motivo: 'monto_invalido' }]);
  });

  it('Probar conexión detecta una llave de otro país por la moneda del negocio', async () => {
    const clock = new FakeClock();
    const mockCO = new MasterShopMock({ apiKey: 'llave-co', clock });
    mockCO.seedProduct({ idProduct: 1, name: 'P', basePrice: 1000, variants: [] });
    const comoEC = new MasterShopClient({ apiKey: 'llave-co', fetch: mockCO.fetch, clock, currency: 'USD' });
    const r = await comoEC.testCredentials();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('COP');
    const comoCO = new MasterShopClient({ apiKey: 'llave-co', fetch: mockCO.fetch, clock, currency: 'COP' });
    expect(await comoCO.testCredentials()).toEqual({ ok: true, message: 'Conexión con MasterShop correcta.' });
  });
});
