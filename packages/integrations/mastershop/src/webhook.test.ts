import { describe, expect, it } from 'vitest';
import {
  esDatosJobCrear,
  esDatosJobSync,
  jobIdCrear,
  jobIdEtiqueta,
  jobIdSync,
} from './jobs';
import { MasterShopMock, mockLabelPdf } from './mock';
import { FakeClock } from './clock';
import {
  idEventoNotificacion,
  parsearNotificacion,
  payloadRegistrable,
  verificarSecretoRuta,
} from './webhook';

const SECRETO = 'a'.repeat(40);

/** Sobre observado en la colección (2026-10-02): `{ eventName, body }` con el pedido completo. */
const NOTIFICACION = {
  eventName: 'Pedido con Novedad',
  body: {
    id_order: 1001,
    external_order_id: 'IZ-CO-000123',
    id_status: 6,
    carrier_status_info: { id_carrier_status_update: 77, carrier_status: 'Pedido con Novedad', carrier_status_code: 'NOV' },
    carrier_novelty: { noveltyCode: 'N1', description: 'Dirección errada', note: null },
    customer: { full_name: 'Laura Gomez', phone: '3001234567' },
    date_update_order: '2026-10-02T14:32:10.000Z',
  },
};

describe('secreto de la ruta del webhook', () => {
  it('acepta solo el secreto exacto y rechaza secretos ausentes o cortos', () => {
    expect(verificarSecretoRuta(SECRETO, SECRETO)).toBe(true);
    expect(verificarSecretoRuta(`${SECRETO}b`, SECRETO)).toBe(false);
    expect(verificarSecretoRuta('', SECRETO)).toBe(false);
    expect(verificarSecretoRuta('corto', 'corto')).toBe(false);
    expect(verificarSecretoRuta(SECRETO, undefined)).toBe(false);
  });
});

describe('parsearNotificacion', () => {
  it('extrae la referencia y el subestado de la transportadora', () => {
    expect(parsearNotificacion(NOTIFICACION)).toEqual({
      eventName: 'Pedido con Novedad',
      providerOrderId: 1001,
      externalOrderId: 'IZ-CO-000123',
      idStatus: 6,
      carrierStatus: 'Pedido con Novedad',
      carrierStatusCode: 'NOV',
      dateUpdate: '2026-10-02T14:32:10.000Z',
    });
  });

  it('tolera camelCase e ids en texto; descarta referencias inválidas', () => {
    const n = parsearNotificacion({ body: { idOrder: '1002', externalOrderId: 'IZ_CO_1', idStatus: 2 } });
    expect(n).toMatchObject({ providerOrderId: 1002, externalOrderId: null, idStatus: 2 });
    expect(parsearNotificacion({ body: { id_status: 2 } })).toBeNull();
    expect(parsearNotificacion('texto')).toBeNull();
    expect(parsearNotificacion([1])).toBeNull();
  });

  it('el id del evento es estable ante reentregas y cambia con el subestado', () => {
    const a = parsearNotificacion(NOTIFICACION)!;
    const b = parsearNotificacion(structuredClone(NOTIFICACION))!;
    expect(idEventoNotificacion(a)).toBe(idEventoNotificacion(b));
    expect(idEventoNotificacion(a)).toMatch(/^1001\.6\.[0-9a-f]{16}$/);
    const enReparto = structuredClone(NOTIFICACION);
    enReparto.body.carrier_status_info.carrier_status = 'Pedido en reparto';
    expect(idEventoNotificacion(parsearNotificacion(enReparto)!)).not.toBe(idEventoNotificacion(a));
  });

  it('el payload registrable no lleva datos del cliente', () => {
    const p = payloadRegistrable(parsearNotificacion(NOTIFICACION)!);
    expect(JSON.stringify(p)).not.toContain('Laura');
    expect(JSON.stringify(p)).not.toContain('3001234567');
  });
});

describe('contrato de la cola carrier', () => {
  it('ids de job deterministas y sin dos puntos', () => {
    expect(jobIdCrear('ord-1')).toBe('carrier.create.ord-1');
    expect(jobIdCrear('ord-1', 2)).toBe('carrier.create.ord-1.r2');
    expect(jobIdEtiqueta('ord-1', 3)).toBe('carrier.poll_label.ord-1.3');
    expect(jobIdSync('1001.6.abc')).toBe('carrier.sync.1001.6.abc');
    expect(() => jobIdCrear('a:b')).toThrow();
  });

  it('valida los datos de los jobs', () => {
    expect(esDatosJobCrear({ order_id: 'ord-1', intento: 0 })).toBe(true);
    expect(esDatosJobCrear({ order_id: 'ord-1', intento: -1 })).toBe(false);
    expect(esDatosJobSync({ event_id: null, provider_order_id: 5, external_order_id: null, origen: 'polling' })).toBe(true);
    expect(esDatosJobSync({ event_id: null, provider_order_id: null, external_order_id: null, origen: 'webhook' })).toBe(false);
  });
});

describe('mock: etiqueta automática al confirmar', () => {
  it('adjunta guía al pasar 1→2 y sirve el PDF sin llave', async () => {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: 'k', clock, autoLabelOnConfirm: true });
    const o = mock.seed({ externalOrderId: 'IZ-CO-1', createdAt: new Date(clock.now()) });
    const put = await mock.fetch(`https://prod.api.mastershop.com/api/orders/${o.idOrder}`, {
      method: 'PUT',
      headers: { 'ms-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ idStatus: 2 }),
    });
    expect(put.status).toBe(200);
    expect(o.shippingLabel).toBe(`https://labels.example.com/MOCK${o.idOrder}.pdf`);
    const ua = { headers: { 'user-agent': 'prueba/1.0' } };
    const pdf = await mock.fetch(o.shippingLabel!, ua);
    expect(pdf.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(mockLabelPdf(`MOCK${o.idOrder}`));
    expect((await mock.fetch('https://labels.example.com/OTRA.pdf', ua)).status).toBe(404);
    // Trampa del CDN real (D-044): sin User-Agent, 403.
    expect((await mock.fetch(o.shippingLabel!)).status).toBe(403);
  });
});
