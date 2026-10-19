import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { VerifiedEvent } from '../contracts';
import {
  amountSchema,
  cartItemSchema,
  cartSchema,
  checkoutInputSchema,
  checkoutInputSchemaFor,
  discountCodeInputSchema,
  documentSchemaFor,
  normalizeDocumentNumber,
  normalizeName,
  normalizePhone,
  orderSummarySchema,
  personNameSchema,
  phoneSchemaFor,
  verifiedEventSchema,
} from './index';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('schemas: celular por país (§10.1)', () => {
  it('Colombia: 10 dígitos que empiezan por 3', () => {
    expect(normalizePhone('CO', '3001234567')).toEqual({
      national: '3001234567',
      e164: '+573001234567',
    });
    expect(normalizePhone('CO', '300 123 4567')?.national).toBe('3001234567');
    expect(normalizePhone('CO', '(300) 123-4567')?.national).toBe('3001234567');
    expect(normalizePhone('CO', '+57 300 123 4567')?.national).toBe('3001234567');
    expect(normalizePhone('CO', '573001234567')?.national).toBe('3001234567');
  });

  it('Colombia: rechaza fijos, longitudes incorrectas y letras', () => {
    for (const raw of ['6041234567', '300123456', '30012345678', '30012345a7', '', '+593991234567']) {
      expect(normalizePhone('CO', raw)).toBeNull();
    }
  });

  it('Ecuador: 9 dígitos que empiezan por 9 (acepta el 0 inicial y +593)', () => {
    expect(normalizePhone('EC', '991234567')).toEqual({
      national: '991234567',
      e164: '+593991234567',
    });
    expect(normalizePhone('EC', '0991234567')?.national).toBe('991234567');
    expect(normalizePhone('EC', '+593 99 123 4567')?.national).toBe('991234567');
  });

  it('Ecuador: rechaza lo que no es celular', () => {
    for (const raw of ['22345678', '891234567', '99123456', '9912345678', '3001234567']) {
      expect(normalizePhone('EC', raw)).toBeNull();
    }
  });

  it('phoneSchemaFor transforma al formato normalizado', () => {
    expect(phoneSchemaFor('CO').parse(' 300-123-4567 ')).toEqual({
      national: '3001234567',
      e164: '+573001234567',
    });
    expect(phoneSchemaFor('EC').safeParse('3001234567').success).toBe(false);
  });
});

describe('schemas: documento por país', () => {
  it('tipos válidos de Colombia', () => {
    for (const type of ['CC', 'CE', 'NIT', 'PAS', 'TI']) {
      expect(documentSchemaFor('CO').safeParse({ type, number: '1020304050' }).success).toBe(true);
    }
    expect(documentSchemaFor('CO').safeParse({ type: 'RUC', number: '1020304050' }).success).toBe(
      false,
    );
  });

  it('tipos válidos de Ecuador: cédula 10 dígitos, RUC 13 dígitos', () => {
    const s = documentSchemaFor('EC');
    expect(s.safeParse({ type: 'CEDULA', number: '1712345678' }).success).toBe(true);
    expect(s.safeParse({ type: 'CEDULA', number: '171234567' }).success).toBe(false);
    expect(s.safeParse({ type: 'RUC', number: '1712345678001' }).success).toBe(true);
    expect(s.safeParse({ type: 'RUC', number: '171234567800' }).success).toBe(false);
    expect(s.safeParse({ type: 'PASAPORTE', number: 'AB123456' }).success).toBe(true);
    expect(s.safeParse({ type: 'CC', number: '1712345678' }).success).toBe(false);
  });

  it('normaliza puntos, espacios y guiones del número', () => {
    expect(normalizeDocumentNumber('1.020.304.050')).toBe('1020304050');
    expect(normalizeDocumentNumber(' 900 123 456-7 ')).toBe('9001234567');
    expect(normalizeDocumentNumber('ab-123.456')).toBe('AB123456');
    expect(documentSchemaFor('CO').parse({ type: 'CC', number: '1.020.304.050' })).toEqual({
      type: 'CC',
      number: '1020304050',
    });
  });

  it('documentos numéricos de Colombia no admiten letras', () => {
    const s = documentSchemaFor('CO');
    expect(s.safeParse({ type: 'CC', number: '10203A4050' }).success).toBe(false);
    expect(s.safeParse({ type: 'NIT', number: '900123456X' }).success).toBe(false);
    expect(s.safeParse({ type: 'PAS', number: 'AB123456' }).success).toBe(true);
    expect(s.safeParse({ type: 'CE', number: 'E123456' }).success).toBe(true);
  });

  it('rechaza documento vacío o demasiado corto', () => {
    expect(documentSchemaFor('CO').safeParse({ type: 'CC', number: '' }).success).toBe(false);
    expect(documentSchemaFor('CO').safeParse({ type: 'CC', number: '12' }).success).toBe(false);
  });
});

describe('schemas: nombres solo con letras y espacios (§10.2, §14.3)', () => {
  it('conserva tildes, ñ y diéresis', () => {
    expect(normalizeName('José Ñúñez Güiza')).toBe('José Ñúñez Güiza');
  });

  it('quita dígitos, signos y emojis; colapsa espacios', () => {
    expect(normalizeName('  Laura   María 2 ')).toBe('Laura María');
    expect(normalizeName("O'Neil")).toBe('ONeil');
    expect(normalizeName('Ana-Lucía')).toBe('Ana Lucía');
    expect(normalizeName('Pedro 😀 Pérez.')).toBe('Pedro Pérez');
  });

  it('normaliza formas descompuestas (NFD) a NFC', () => {
    expect(normalizeName('José')).toBe('José');
  });

  it('personNameSchema rechaza nombres sin letras', () => {
    expect(personNameSchema.safeParse('1234').success).toBe(false);
    expect(personNameSchema.safeParse('   ').success).toBe(false);
    expect(personNameSchema.parse(' laura ')).toBe('laura');
  });
});

describe('schemas: montos', () => {
  it('amountSchema acepta bigint, texto entero y number entero seguro', () => {
    expect(amountSchema.parse(90_000n)).toBe(90_000n);
    expect(amountSchema.parse('9007199254740993')).toBe(9_007_199_254_740_993n);
    expect(amountSchema.parse(90_000)).toBe(90_000n);
  });

  it('amountSchema rechaza decimales y números inseguros', () => {
    for (const v of [49.9, '49.90', Number.MAX_SAFE_INTEGER + 2, '1e5', '', null]) {
      expect(amountSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('schemas: carrito', () => {
  it('item del carrito: variante y cantidad entera positiva; el precio NO lo manda el cliente', () => {
    expect(cartItemSchema.parse({ variant_id: UUID(1), quantity: 2 })).toEqual({
      variant_id: UUID(1),
      quantity: 2,
    });
    for (const quantity of [0, -1, 1.5, '2']) {
      expect(cartItemSchema.safeParse({ variant_id: UUID(1), quantity }).success).toBe(false);
    }
    expect(cartItemSchema.safeParse({ variant_id: 'x', quantity: 1 }).success).toBe(false);
    expect(
      cartItemSchema.safeParse({ variant_id: UUID(1), quantity: 1, unit_price: 1 }).success,
    ).toBe(false);
  });

  it('carrito sin variantes repetidas', () => {
    expect(
      cartSchema.safeParse([
        { variant_id: UUID(1), quantity: 1 },
        { variant_id: UUID(1), quantity: 2 },
      ]).success,
    ).toBe(false);
  });

  it('código de descuento se normaliza a mayúsculas sin espacios', () => {
    expect(discountCodeInputSchema.parse(' izao 10 ')).toBe('IZAO10');
    expect(discountCodeInputSchema.safeParse('IZAO%10').success).toBe(false);
    expect(discountCodeInputSchema.safeParse('').success).toBe(false);
  });
});

function checkoutValido(extra: Record<string, unknown> = {}) {
  return {
    country_code: 'CO',
    idempotency_key: UUID(99),
    items: [{ variant_id: UUID(1), quantity: 1 }],
    contact: {
      first_name: 'Laura',
      last_name: 'Gómez',
      phone: '300 123 4567',
      email: 'Laura@Example.com',
    },
    document: { type: 'CC', number: '1.020.304.050' },
    shipping: {
      region_id: UUID(10),
      city_id: UUID(11),
      district: 'El Poblado',
      address1: 'Calle 10 # 43-20',
      address2: 'Apto 501',
      notes: null,
    },
    payment_method: 'wompi',
    discount_code: 'izao10',
    consents: { terms_and_data: true, whatsapp: false },
    data_policy_version: '2026-10',
    ...extra,
  };
}

describe('schemas: entrada del checkout (§10.1, §10.2)', () => {
  it('acepta un checkout válido y normaliza', () => {
    const r = checkoutInputSchema.parse(checkoutValido());
    expect(r.contact).toEqual({
      first_name: 'Laura',
      last_name: 'Gómez',
      phone_national: '3001234567',
      phone_e164: '+573001234567',
      email: 'laura@example.com',
    });
    expect(r.document).toEqual({ type: 'CC', number: '1020304050' });
    expect(r.discount_code).toBe('IZAO10');
  });

  it('exige aceptar términos y tratamiento de datos', () => {
    const r = checkoutInputSchema.safeParse(
      checkoutValido({ consents: { terms_and_data: false, whatsapp: true } }),
    );
    expect(r.success).toBe(false);
  });

  it('contra entrega exige autorización de WhatsApp', () => {
    expect(
      checkoutInputSchema.safeParse(checkoutValido({ payment_method: 'cod' })).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse(
        checkoutValido({
          payment_method: 'cod',
          consents: { terms_and_data: true, whatsapp: true },
        }),
      ).success,
    ).toBe(true);
  });

  it('valida celular y documento según el país del pedido', () => {
    const ec = checkoutValido({
      country_code: 'EC',
      contact: { first_name: 'Ana', last_name: 'Ruiz', phone: '0991234567', email: null },
      document: { type: 'CEDULA', number: '1712345678' },
      payment_method: 'manual',
    });
    const r = checkoutInputSchema.parse(ec);
    expect(r.contact.phone_e164).toBe('+593991234567');
    // Celular colombiano en Ecuador: inválido
    expect(
      checkoutInputSchema.safeParse({
        ...ec,
        contact: { first_name: 'Ana', last_name: 'Ruiz', phone: '3001234567', email: null },
      }).success,
    ).toBe(false);
    // Documento colombiano en Ecuador: inválido
    expect(
      checkoutInputSchema.safeParse({ ...ec, document: { type: 'CC', number: '1020304050' } })
        .success,
    ).toBe(false);
  });

  it('rechaza nombres que quedan vacíos tras normalizar', () => {
    const r = checkoutInputSchema.safeParse(
      checkoutValido({
        contact: { first_name: '123', last_name: 'Gómez', phone: '3001234567', email: null },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rechaza correo inválido, sin dirección, método desconocido y carrito vacío', () => {
    expect(
      checkoutInputSchema.safeParse(
        checkoutValido({
          contact: { first_name: 'L', last_name: 'G', phone: '3001234567', email: 'no-es-correo' },
        }),
      ).success,
    ).toBe(false);
    const sinDir = checkoutValido();
    (sinDir.shipping as Record<string, unknown>).address1 = '  ';
    expect(checkoutInputSchema.safeParse(sinDir).success).toBe(false);
    expect(checkoutInputSchema.safeParse(checkoutValido({ payment_method: 'paypal' })).success).toBe(
      false,
    );
    expect(checkoutInputSchema.safeParse(checkoutValido({ items: [] })).success).toBe(false);
  });

  it('rechaza campos de dinero enviados por el cliente (el servidor manda)', () => {
    expect(checkoutInputSchema.safeParse(checkoutValido({ total: 1 })).success).toBe(false);
  });

  it('A3: checkoutInputSchemaFor rechaza manual si el país tiene métodos activos', () => {
    const co = checkoutInputSchemaFor(['wompi', 'cod']);
    expect(co.safeParse(checkoutValido({ payment_method: 'manual' })).success).toBe(false);
    expect(co.safeParse(checkoutValido({ payment_method: 'wompi' })).success).toBe(true);
    // Método válido en forma pero apagado en el país
    expect(co.safeParse(checkoutValido({ payment_method: 'addi' })).success).toBe(false);
  });

  it('A3: checkoutInputSchemaFor acepta manual solo si el país no tiene métodos activos', () => {
    const ec = checkoutInputSchemaFor([]);
    const pedido = checkoutValido({
      country_code: 'EC',
      contact: { first_name: 'Ana', last_name: 'Ruiz', phone: '0991234567', email: null },
      document: { type: 'CEDULA', number: '1712345678' },
      payment_method: 'manual',
    });
    expect(ec.safeParse(pedido).success).toBe(true);
    expect(ec.safeParse({ ...pedido, payment_method: 'wompi' }).success).toBe(false);
    expect(checkoutInputSchemaFor(['wompi']).safeParse(pedido).success).toBe(false);
  });

  it('código de descuento opcional', () => {
    const sinCodigo: Record<string, unknown> = checkoutValido();
    delete sinCodigo.discount_code;
    expect(checkoutInputSchema.parse(sinCodigo).discount_code).toBeNull();
  });
});

describe('schemas: resumen de pedido', () => {
  it('convierte montos en texto a bigint y valida coherencia del total', () => {
    const r = orderSummarySchema.parse({
      number: 'IZ-CO-000123',
      country_code: 'CO',
      currency_code: 'COP',
      status: 'esperando_abono',
      payment_method: 'cod',
      lines: [
        {
          name: 'Perfume 100 ml',
          variant_label: '100 ml',
          quantity: 1,
          unit_price: '90000',
          line_discount: '9000',
        },
      ],
      subtotal: '90000',
      discount: '9000',
      surcharge: '0',
      total_customer: '81000',
      cod_deposit: '10000',
      cod_collect: '71000',
    });
    expect(r.total_customer).toBe(81_000n);
    expect(r.lines[0]!.unit_price).toBe(90_000n);
  });

  it('rechaza un resumen cuyo total no cuadra', () => {
    const r = orderSummarySchema.safeParse({
      number: 'IZ-CO-000123',
      country_code: 'CO',
      currency_code: 'COP',
      status: 'pagado',
      payment_method: 'wompi',
      lines: [],
      subtotal: '90000',
      discount: '0',
      surcharge: '0',
      total_customer: '80000',
      cod_deposit: '0',
      cod_collect: '0',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza moneda que no es la del país', () => {
    const r = orderSummarySchema.safeParse({
      number: 'IZ-EC-000001',
      country_code: 'EC',
      currency_code: 'COP',
      status: 'pendiente_manual',
      payment_method: 'manual',
      lines: [],
      subtotal: '0',
      discount: '0',
      surcharge: '0',
      total_customer: '0',
      cod_deposit: '0',
      cod_collect: '0',
    });
    expect(r.success).toBe(false);
  });
});

describe('schemas: VerifiedEvent', () => {
  it('su tipo coincide con el contrato', () => {
    expectTypeOf<z.output<typeof verifiedEventSchema>>().toEqualTypeOf<VerifiedEvent>();
  });

  it('valida un evento con referencias', () => {
    const e = verifiedEventSchema.parse({
      provider: 'wompi',
      event_id: 'evt-123',
      event_type: 'transaction.updated',
      occurred_at: '2026-10-19T15:00:00.000Z',
      refs: { provider_transaction_id: '123-abc', provider_reference: null, payment_link_id: null },
      payload: { any: 'thing' },
    });
    expect(e.event_id).toBe('evt-123');
  });

  it('rechaza evento sin id de idempotencia o con fecha inválida', () => {
    const base = {
      provider: 'wompi',
      event_type: 'transaction.updated',
      occurred_at: null,
      refs: { provider_transaction_id: null, provider_reference: null, payment_link_id: null },
      payload: {},
    };
    expect(verifiedEventSchema.safeParse({ ...base, event_id: '' }).success).toBe(false);
    expect(
      verifiedEventSchema.safeParse({ ...base, event_id: 'x', occurred_at: 'ayer' }).success,
    ).toBe(false);
  });
});
