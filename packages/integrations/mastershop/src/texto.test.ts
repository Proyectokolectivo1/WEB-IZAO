import { describe, expect, it } from 'vitest';
import { buildCarrierOrder, CarrierOrderError, MasterShopOrderBodySchema } from './order';
import {
  aLugarMasterShop,
  aNombreMasterShop,
  MASTERSHOP_NAME_PATTERN,
  MASTERSHOP_PLACE_PATTERN,
  sinDiacriticos,
} from './texto';
import { MasterShopMock } from './mock/server';
import { FakeClock } from './clock';
import { MasterShopClient } from './client';
import { serializeMasterShopJson } from './json';
import { makeOrder, makeOrderEC } from './test-utils/orders';

/** Regla exacta del 400 de producción (D-060). */
const REGLA_CITY = /^[A-Za-z0-9 ().-]+$/;

describe('aLugarMasterShop — ciudad y departamento (D-060)', () => {
  it.each([
    ['ITAGÜÍ', 'ITAGUI'],
    ['BOGOTÁ, D.C.', 'BOGOTA D.C.'],
    ['Bogotá, D.C.', 'Bogota D.C.'],
    ['MEDELLÍN', 'MEDELLIN'],
    ['CÚCUTA', 'CUCUTA'],
    ['PEÑOL', 'PENOL'],
    ['EL CARMEN DE VIBORAL', 'EL CARMEN DE VIBORAL'],
    ['SAN ANDRÉS (ISLA)', 'SAN ANDRES (ISLA)'],
    ['POPAYÁN', 'POPAYAN'],
    ['IBAGUÉ', 'IBAGUE'],
    ['Archipiélago de San Andrés, Providencia y Santa Catalina', 'Archipielago de San Andres Providencia y Santa Catalina'],
    ['Nariño', 'Narino'],
    ['Santo Domingo de los Tsáchilas', 'Santo Domingo de los Tsachilas'],
    ['Cañar', 'Canar'],
    ["SAN JUAN D'ARAMA", 'SAN JUAN D ARAMA'],
    ['SAN JUAN D’ARAMA', 'SAN JUAN D ARAMA'],
    ['  TOLÚ   VIEJO  ', 'TOLU VIEJO'],
    ['SANTA ROSA DE OSOS - ZONA 2', 'SANTA ROSA DE OSOS - ZONA 2'],
    ['MOMPÓS/MOMPOX #1; ¿ok?', 'MOMPOS MOMPOX 1 ok'],
    ['Straße Æon Øster', 'Strasse AEon Oster'],
    ['Í́TAGÜI', 'ITAGUI'],
  ])('%s → %s', (entrada, esperado) => {
    const r = aLugarMasterShop(entrada);
    expect(r).toBe(esperado);
    expect(r).toMatch(REGLA_CITY);
    expect(r).toMatch(MASTERSHOP_PLACE_PATTERN);
  });

  it('devuelve vacío si no queda nada válido (emoji, solo símbolos)', () => {
    expect(aLugarMasterShop('🏙️ ¡¿!')).toBe('');
    expect(aLugarMasterShop('')).toBe('');
  });

  it('es idempotente', () => {
    for (const t of ['ITAGÜÍ', 'BOGOTÁ, D.C.', 'SAN ANDRÉS (ISLA)']) {
      expect(aLugarMasterShop(aLugarMasterShop(t))).toBe(aLugarMasterShop(t));
    }
  });
});

describe('aNombreMasterShop — nombres solo letras ASCII y espacios', () => {
  it.each([
    ['José', 'Jose'],
    ['Peña Muñoz', 'Pena Munoz'],
    ['Güiza', 'Guiza'],
    ['María-José', 'Maria Jose'],
    ['Ana2  Ruiz.', 'Ana Ruiz'],
  ])('%s → %s', (entrada, esperado) => {
    expect(aNombreMasterShop(entrada)).toBe(esperado);
    expect(aNombreMasterShop(entrada)).toMatch(MASTERSHOP_NAME_PATTERN);
  });

  it('sinDiacriticos conserva mayúsculas y lo que no tiene tilde', () => {
    expect(sinDiacriticos('ÁÉÍÓÚÜÑ áéíóúüñ #, 123')).toBe('AEIOUUN aeiouun #, 123');
  });
});

describe('buildCarrierOrder — el cuerpo cumple la regla de city de MasterShop (D-060)', () => {
  const opts = { mode: 'prorate' as const, paymentGateway: 'wompi', paymentReference: 'ref-1' };

  it.each(['ITAGÜÍ', 'BOGOTÁ, D.C.', 'MEDELLÍN', 'CÚCUTA', 'PEÑOL', 'SAN ANDRÉS (ISLA)', "SAN JUAN D'ARAMA"])(
    'ciudad %s: shipping y billing pasan la regla',
    (ciudad) => {
      const { body } = buildCarrierOrder(makeOrder({ shipping_city_name: ciudad }), opts);
      expect(body.shipping_address.city).toMatch(REGLA_CITY);
      expect(body.billing_address.city).toMatch(REGLA_CITY);
      expect(body.shipping_address.state).toMatch(REGLA_CITY);
      expect(MasterShopOrderBodySchema.safeParse(body).success).toBe(true);
    },
  );

  it('ITAGÜÍ / Antioquia (IZ-CO-000051/52) → ITAGUI / Antioquia', () => {
    const { body } = buildCarrierOrder(
      makeOrder({ shipping_city_name: 'ITAGÜÍ', shipping_region_name: 'Antioquia' }),
      opts,
    );
    expect(body.shipping_address).toMatchObject({ city: 'ITAGUI', state: 'Antioquia' });
    expect(body.billing_address).toMatchObject({ city: 'ITAGUI', state: 'Antioquia' });
  });

  it('departamento con tilde y coma: «Bogotá, D.C.» → «Bogota D.C.»', () => {
    const { body } = buildCarrierOrder(
      makeOrder({ shipping_city_name: 'BOGOTÁ, D.C.', shipping_region_name: 'Bogotá, D.C.' }),
      opts,
    );
    expect(body.shipping_address).toMatchObject({ city: 'BOGOTA D.C.', state: 'Bogota D.C.' });
  });

  it('Ecuador: provincia y cantón sin tildes', () => {
    const { body } = buildCarrierOrder(
      makeOrderEC({ shipping_region_name: 'Manabí', shipping_city_name: 'Portoviejo' }),
      opts,
    );
    expect(body.shipping_address).toMatchObject({ state: 'Manabi', city: 'Portoviejo' });
  });

  it('no toca dirección, barrio, notas ni el pedido guardado', () => {
    const order = makeOrder({
      shipping_city_name: 'ITAGÜÍ',
      shipping_address1: 'Cra 50 # 45-20, Torre Ñ',
      shipping_address2: 'Apto 501 (patio)',
      shipping_district: 'Santa María',
    });
    const copia = structuredClone(order);
    const { body } = buildCarrierOrder(order, opts);
    expect(body.shipping_address.address1).toBe('Cra 50 # 45-20, Torre Ñ');
    expect(body.shipping_address.address2).toBe('Apto 501 (patio)');
    expect(body.shipping_address.district).toBe('Santa María');
    expect(order).toEqual(copia);
    expect(order.shipping_city_name).toBe('ITAGÜÍ');
  });

  it('una ciudad que queda vacía tras normalizar es "direccion_incompleta", no un 400', () => {
    try {
      buildCarrierOrder(makeOrder({ shipping_city_name: '¡¿?!' }), opts);
      throw new Error('se esperaba CarrierOrderError');
    } catch (e) {
      expect(e).toBeInstanceOf(CarrierOrderError);
      expect((e as CarrierOrderError).issues.map((i) => i.code)).toEqual(['direccion_incompleta']);
    }
  });

  it('el esquema rechaza una ciudad con tilde (defensa final)', () => {
    const { body } = buildCarrierOrder(makeOrder(), opts);
    const malo = { ...body, shipping_address: { ...body.shipping_address, city: 'ITAGÜÍ' } };
    expect(MasterShopOrderBodySchema.safeParse(malo).success).toBe(false);
  });
});

describe('mock de MasterShop — reproduce el 400 de city de producción', () => {
  it('rechaza ITAGÜÍ con el mensaje exacto y acepta ITAGUI', async () => {
    const clock = new FakeClock();
    const mock = new MasterShopMock({ apiKey: 'k', clock });
    const client = new MasterShopClient({ apiKey: 'k', fetch: mock.fetch, clock });
    const { body } = buildCarrierOrder(
      makeOrder({ shipping_city_name: 'ITAGÜÍ' }),
      { mode: 'prorate', paymentGateway: 'wompi', paymentReference: null },
    );
    const malo = {
      ...body,
      shipping_address: { ...body.shipping_address, city: 'ITAGÜÍ' },
      billing_address: { ...body.billing_address, city: 'ITAGÜÍ' },
    };
    // El cliente ya lo frena antes de salir (esquema local), sin llamar a MasterShop.
    await expect(client.createOrder(malo)).rejects.toMatchObject({ status: null });
    expect(mock.orders.size).toBe(0);
    // Enviado en crudo, el mock responde como producción.
    const res = await mock.fetch('https://prod.api.mastershop.com/api/orders', {
      method: 'POST',
      headers: { 'ms-api-key': 'k', 'content-type': 'application/json' },
      body: serializeMasterShopJson(malo),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; data: unknown };
    expect(json.error).toBe('Datos del body inválidos');
    expect(json.data).toEqual([
      { path: ['shipping_address', 'city'], message: 'Solo alfanuméricos, espacios, guiones, paréntesis y puntos' },
      { path: ['billing_address', 'city'], message: 'Solo alfanuméricos, espacios, guiones, paréntesis y puntos' },
    ]);
    expect(mock.orders.size).toBe(0);
    await client.createOrder(body);
    expect(mock.orders.size).toBe(1);
  });
});
