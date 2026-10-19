import { describe, expect, it } from 'vitest';
import { buildCarrierOrder, CarrierOrderError, MasterShopOrderBodySchema } from './order';
import type { CarrierOrderIssueCode, CarrierOrderOptions } from './order';
import { serializeMasterShopJson } from './json';
import { makeItem, makeOrder } from './test-utils/orders';

const opts: CarrierOrderOptions = {
  mode: 'prorate',
  paymentGateway: 'wompi',
  paymentReference: '12345-xyz',
};

function issueCodes(fn: () => unknown): CarrierOrderIssueCode[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof CarrierOrderError) return e.issues.map((i) => i.code);
    throw e;
  }
  throw new Error('se esperaba CarrierOrderError');
}

const ADDRESS_KEYS = [
  'address1',
  'address2',
  'city',
  'company',
  'country',
  'district',
  'first_name',
  'full_name',
  'last_name',
  'phone',
  'state',
  'zip',
];

describe('buildCarrierOrder — forma del cuerpo de POST /api/orders (§14.3)', () => {
  it('produce el ejemplo de §14.3 para contra entrega', () => {
    const { body } = buildCarrierOrder(makeOrder(), opts);
    expect(body).toEqual({
      id_order: 'IZ-CO-000123',
      shipping_address: {
        zip: null,
        country: 'CO',
        city: 'MEDELLÍN',
        state: 'ANTIOQUIA',
        address1: 'Calle 10 # 43-20',
        address2: 'Apto 501',
        district: 'El Poblado',
        full_name: 'Laura Gómez',
        first_name: 'Laura',
        last_name: 'Gómez',
        phone: '3001234567',
        company: null,
      },
      billing_address: body.shipping_address,
      order_transaction: {
        total: 80_000n,
        currency: 'COP',
        payment_method: 'cod',
        payment_gateway: 'wompi',
      },
      customer: {
        full_name: 'Laura Gómez',
        first_name: 'Laura',
        last_name: 'Gómez',
        phone: '3001234567',
        email: 'laura@example.com',
        documentType: 'CC',
        documentNumber: '1020304050',
        tags: [],
      },
      order_items: [
        {
          id_product: 2001,
          id_variant: null,
          quantity: 1,
          sku: 'IZ-0001-100',
          name: 'Fragancia de prueba 100 ml',
          weight: 0.5,
          price: 80_000n,
        },
      ],
      additional_charge: [],
      notes: ['Pedido web IZ-CO-000123', 'Abono recibido $ 10.000 Wompi ref 12345-xyz'],
      tags: ['web', 'cod-abono'],
    });
  });

  it('incluye TODAS las claves, también las que van en null (company, zip, address2)', () => {
    const order = makeOrder({
      shipping_address2: null,
      shipping_district: null,
      shipping_zip: null,
    });
    const { body } = buildCarrierOrder(order, opts);
    expect(Object.keys(body).sort()).toEqual(
      [
        'additional_charge',
        'billing_address',
        'customer',
        'id_order',
        'notes',
        'order_items',
        'order_transaction',
        'shipping_address',
        'tags',
      ].sort(),
    );
    for (const addr of [body.shipping_address, body.billing_address]) {
      expect(Object.keys(addr).sort()).toEqual(ADDRESS_KEYS);
      expect(addr.company).toBeNull();
      expect(addr.zip).toBeNull();
      expect(addr.address2).toBeNull();
      expect(addr.district).toBeNull();
    }
    expect(Object.keys(body.customer).sort()).toEqual(
      [
        'documentNumber',
        'documentType',
        'email',
        'first_name',
        'full_name',
        'last_name',
        'phone',
        'tags',
      ].sort(),
    );
    expect(Object.keys(body.order_transaction).sort()).toEqual(
      ['currency', 'payment_gateway', 'payment_method', 'total'].sort(),
    );
    // Al serializar, las claves en null siguen presentes.
    const json = serializeMasterShopJson(body);
    expect(json).toContain('"company":null');
    expect(json).toContain('"zip":null');
    expect(json).toContain('"address2":null');
  });

  it('convierte cadenas vacías en null', () => {
    const { body } = buildCarrierOrder(
      makeOrder({ shipping_address2: '   ', shipping_zip: '' }),
      opts,
    );
    expect(body.shipping_address.address2).toBeNull();
    expect(body.shipping_address.zip).toBeNull();
  });

  it('el cuerpo resultante pasa el esquema zod', () => {
    const { body } = buildCarrierOrder(makeOrder(), opts);
    expect(MasterShopOrderBodySchema.safeParse(body).success).toBe(true);
  });
});

describe('buildCarrierOrder — id_order', () => {
  it('id_order = orders.number', () => {
    expect(buildCarrierOrder(makeOrder({ number: 'IZ-CO-000999' }), opts).body.id_order).toBe(
      'IZ-CO-000999',
    );
  });

  it('rechaza guion bajo (la consulta por externalOrderId no lo acepta)', () => {
    expect(
      issueCodes(() => buildCarrierOrder(makeOrder({ number: 'IZ_CO_000123' }), opts)),
    ).toEqual(['numero_invalido']);
  });

  it('rechaza espacios, símbolos y vacío', () => {
    for (const number of ['IZ CO 1', 'IZ-CO-0001#', '', 'IZ-CO-ñ1']) {
      expect(issueCodes(() => buildCarrierOrder(makeOrder({ number }), opts))).toContain(
        'numero_invalido',
      );
    }
  });
});

describe('buildCarrierOrder — nombres solo letras y espacios', () => {
  it('limpia guiones, apóstrofos, puntos, dígitos y espacios repetidos', () => {
    const { body } = buildCarrierOrder(
      makeOrder({ contact_first_name: '  María-José  ', contact_last_name: "O'Neil  Ruiz Jr. 2" }),
      opts,
    );
    expect(body.customer.first_name).toBe('María José');
    expect(body.customer.last_name).toBe('ONeil Ruiz Jr');
    expect(body.customer.full_name).toBe('María José ONeil Ruiz Jr');
    expect(body.shipping_address.full_name).toBe('María José ONeil Ruiz Jr');
    for (const n of [body.customer.first_name, body.customer.last_name, body.customer.full_name]) {
      expect(n).toMatch(/^[\p{L} ]+$/u);
    }
  });

  it('rechaza un nombre que queda vacío', () => {
    expect(
      issueCodes(() => buildCarrierOrder(makeOrder({ contact_first_name: '123' }), opts)),
    ).toEqual(['nombre_invalido']);
    expect(
      issueCodes(() => buildCarrierOrder(makeOrder({ contact_last_name: ' - ' }), opts)),
    ).toEqual(['nombre_invalido']);
  });
});

describe('buildCarrierOrder — teléfono nacional de 10 dígitos', () => {
  it('quita el indicativo +57 del E.164', () => {
    const { body } = buildCarrierOrder(makeOrder({ contact_phone_e164: '+573109876543' }), opts);
    expect(body.customer.phone).toBe('3109876543');
    expect(body.shipping_address.phone).toBe('3109876543');
  });

  it('acepta el número ya nacional', () => {
    expect(
      buildCarrierOrder(makeOrder({ contact_phone_e164: '3001234567' }), opts).body.customer.phone,
    ).toBe('3001234567');
  });

  it('rechaza teléfonos que no quedan en 10 dígitos o de otro país', () => {
    for (const phone of ['+57300123456', '+5730012345678', '+593991234567', '', 'abc']) {
      expect(
        issueCodes(() => buildCarrierOrder(makeOrder({ contact_phone_e164: phone }), opts)),
      ).toEqual(['telefono_invalido']);
    }
  });
});

describe('buildCarrierOrder — documento', () => {
  it('los dos o ninguno: sin documento van ambos en null', () => {
    const { body } = buildCarrierOrder(
      makeOrder({ document_type: null, document_number: null }),
      opts,
    );
    expect(body.customer.documentType).toBeNull();
    expect(body.customer.documentNumber).toBeNull();
  });

  it('rechaza tipo sin número y número sin tipo', () => {
    expect(issueCodes(() => buildCarrierOrder(makeOrder({ document_number: null }), opts))).toEqual(
      ['documento_incompleto'],
    );
    expect(issueCodes(() => buildCarrierOrder(makeOrder({ document_type: null }), opts))).toEqual([
      'documento_incompleto',
    ]);
    expect(issueCodes(() => buildCarrierOrder(makeOrder({ document_number: '  ' }), opts))).toEqual(
      ['documento_incompleto'],
    );
  });

  it('acepta los tipos de MasterShop y rechaza los demás', () => {
    for (const t of ['CC', 'NIT', 'CE', 'DIE', 'NITEXT', 'PAS', 'RC', 'TE', 'TI']) {
      expect(
        buildCarrierOrder(makeOrder({ document_type: t }), opts).body.customer.documentType,
      ).toBe(t);
    }
    expect(
      issueCodes(() => buildCarrierOrder(makeOrder({ document_type: 'CEDULA' }), opts)),
    ).toEqual(['documento_tipo_invalido']);
  });
});

describe('buildCarrierOrder — país y moneda', () => {
  it('rechaza moneda que no es legal en el país de la dirección', () => {
    expect(
      issueCodes(() => buildCarrierOrder(makeOrder({ currency_code: 'USD' }), opts)),
    ).toContain('moneda_no_legal');
  });

  it('MasterShop solo opera en Colombia', () => {
    expect(
      issueCodes(() =>
        buildCarrierOrder(makeOrder({ country_code: 'EC', currency_code: 'USD' }), opts),
      ),
    ).toContain('pais_no_soportado');
  });

  it('rechaza pedidos manuales', () => {
    expect(
      issueCodes(() => buildCarrierOrder(makeOrder({ payment_method: 'manual' }), opts)),
    ).toContain('metodo_no_soportado');
  });
});

describe('buildCarrierOrder — ítems', () => {
  it('weight sale de weight_kg y id_product/id_variant de los vínculos', () => {
    const { body } = buildCarrierOrder(
      makeOrder({
        items: [
          makeItem({ weight_kg: 0.75, mastershop_product_id: 3001, mastershop_variant_id: 4001 }),
        ],
      }),
      opts,
    );
    expect(body.order_items[0]).toMatchObject({ id_product: 3001, id_variant: 4001, weight: 0.75 });
  });

  it('una variante sin vínculo da un error tipado con el SKU', () => {
    const order = makeOrder({
      items: [
        makeItem(),
        makeItem({ id: 'item-2', sku: 'IZ-0002-50', mastershop_product_id: null }),
      ],
    });
    try {
      buildCarrierOrder(order, opts);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CarrierOrderError);
      const err = e as CarrierOrderError;
      expect(err.issues).toEqual([
        expect.objectContaining({
          code: 'variante_sin_vinculo',
          path: 'items.1',
          sku: 'IZ-0002-50',
        }),
      ]);
      expect(err.issues[0]?.message).toMatch(/IZ-0002-50/);
    }
  });

  it('rechaza peso faltante o no positivo', () => {
    for (const weight_kg of [null, 0, -1, Number.NaN]) {
      expect(
        issueCodes(() => buildCarrierOrder(makeOrder({ items: [makeItem({ weight_kg })] }), opts)),
      ).toEqual(['peso_invalido']);
    }
  });

  it('agrega la presentación al nombre si no la incluye', () => {
    const { body } = buildCarrierOrder(
      makeOrder({
        items: [makeItem({ name_snapshot: 'Fragancia de prueba', variant_label: '50 ml' })],
      }),
      opts,
    );
    expect(body.order_items[0]?.name).toBe('Fragancia de prueba 50 ml');
  });

  it('una línea partida en el modo B conserva sku, vínculo y peso en cada parte', () => {
    const order = makeOrder({
      payment_method: 'wompi',
      items: [makeItem({ quantity: 3, unit_price: 50_000n, line_discount: 10_000n })],
    });
    const { body } = buildCarrierOrder(order, opts);
    expect(
      body.order_items.map((i) => [i.sku, i.quantity, i.price, i.id_product, i.weight]),
    ).toEqual([
      ['IZ-0001-100', 2, 46_667n, 2001, 0.5],
      ['IZ-0001-100', 1, 46_666n, 2001, 0.5],
    ]);
    expect(body.order_transaction.total).toBe(140_000n);
  });

  it('reúne todos los problemas en un solo error', () => {
    const codes = issueCodes(() =>
      buildCarrierOrder(
        makeOrder({
          number: 'IZ_1',
          contact_phone_e164: '123',
          document_type: null,
          items: [makeItem({ mastershop_product_id: null })],
        }),
        opts,
      ),
    );
    expect(codes.sort()).toEqual(
      [
        'documento_incompleto',
        'numero_invalido',
        'telefono_invalido',
        'variante_sin_vinculo',
      ].sort(),
    );
  });
});

describe('buildCarrierOrder — valor, método, notas y etiquetas (§14.4)', () => {
  it('caso 10 en modo B: ítems 75.000 y 50.000, total 125.000, cod', () => {
    const order = makeOrder({
      items: [
        makeItem({
          sku: 'A',
          unit_price: 90_000n,
          line_discount: 9_000n,
          mastershop_product_id: 1,
        }),
        makeItem({
          id: 'item-2',
          sku: 'B',
          unit_price: 60_000n,
          line_discount: 6_000n,
          mastershop_product_id: 2,
        }),
      ],
    });
    const { body } = buildCarrierOrder(order, opts);
    expect(body.order_items.map((i) => i.price)).toEqual([75_000n, 50_000n]);
    expect(body.order_transaction).toMatchObject({ total: 125_000n, payment_method: 'cod' });
    expect(body.additional_charge).toEqual([]);
  });

  it('caso 10 en modo A: precios reales y additional_charge negativo', () => {
    const order = makeOrder({
      items: [
        makeItem({ sku: 'A', unit_price: 90_000n, line_discount: 9_000n }),
        makeItem({ id: 'item-2', sku: 'B', unit_price: 60_000n, line_discount: 6_000n }),
      ],
    });
    const { body } = buildCarrierOrder(order, { ...opts, mode: 'additional_charge' });
    expect(body.order_items.map((i) => i.price)).toEqual([90_000n, 60_000n]);
    expect(body.additional_charge).toEqual([{ type_charge: 'descuento', value: -25_000n }]);
    expect(serializeMasterShopJson(body)).toContain(
      '"additional_charge":[{"type_charge":"descuento","value":-25000}]',
    );
  });

  it('Wompi completo: pia, etiqueta prepago y nota del pago', () => {
    const order = makeOrder({
      payment_method: 'wompi',
      items: [makeItem({ line_discount: 15_000n })],
    });
    const { body } = buildCarrierOrder(order, opts);
    expect(body.order_transaction).toEqual({
      total: 75_000n,
      currency: 'COP',
      payment_method: 'pia',
      payment_gateway: 'wompi',
    });
    expect(body.tags).toEqual(['web', 'prepago']);
    expect(body.notes).toEqual([
      'Pedido web IZ-CO-000123',
      'Pago recibido $ 75.000 Wompi ref 12345-xyz',
    ]);
  });

  it('Addi: pia con el subtotal; el recargo queda solo en notes', () => {
    const order = makeOrder({
      payment_method: 'addi',
      financing_surcharge_pct: '10.00',
      financing_surcharge_amount: 9_000n,
    });
    const { body } = buildCarrierOrder(order, {
      ...opts,
      paymentGateway: 'addi',
      paymentReference: 'ADDI-77',
    });
    expect(body.order_transaction).toMatchObject({
      total: 90_000n,
      payment_method: 'pia',
      payment_gateway: 'addi',
    });
    expect(body.notes).toEqual([
      'Pedido web IZ-CO-000123',
      'Pago recibido $ 99.000 Addi ref ADDI-77',
      'Recargo de financiación $ 9.000 registrado en la tienda',
    ]);
    expect(body.tags).toEqual(['web', 'prepago']);
  });

  it('sin referencia de pago la nota no la menciona', () => {
    const { body } = buildCarrierOrder(makeOrder(), { ...opts, paymentReference: null });
    expect(body.notes).toEqual(['Pedido web IZ-CO-000123', 'Abono recibido $ 10.000 Wompi']);
  });

  it('el total debe cuadrar con los montos guardados del pedido', () => {
    const order = { ...makeOrder(), cod_collect_amount: 79_999n };
    expect(issueCodes(() => buildCarrierOrder(order, opts))).toEqual(['total_no_cuadra']);
  });

  it('propaga los errores del cálculo de líneas como problema tipado', () => {
    const order = makeOrder({ cod_deposit_amount: 90_000n });
    expect(issueCodes(() => buildCarrierOrder(order, opts))).toEqual(['valor_invalido']);
  });
});

describe('MasterShopOrderBodySchema', () => {
  it('rechaza un cuerpo cuyo total no cuadra', () => {
    const { body } = buildCarrierOrder(makeOrder(), opts);
    const bad = { ...body, order_transaction: { ...body.order_transaction, total: 80_001n } };
    expect(MasterShopOrderBodySchema.safeParse(bad).success).toBe(false);
  });

  it('rechaza claves de más y claves faltantes', () => {
    const { body } = buildCarrierOrder(makeOrder(), opts);
    expect(MasterShopOrderBodySchema.safeParse({ ...body, extra: 1 }).success).toBe(false);
    const noCompany: Partial<typeof body.shipping_address> = { ...body.shipping_address };
    delete noCompany.company;
    expect(
      MasterShopOrderBodySchema.safeParse({ ...body, shipping_address: noCompany }).success,
    ).toBe(false);
  });

  it('rechaza un documento a medias', () => {
    const { body } = buildCarrierOrder(makeOrder(), opts);
    const bad = { ...body, customer: { ...body.customer, documentNumber: null } };
    expect(MasterShopOrderBodySchema.safeParse(bad).success).toBe(false);
  });
});
