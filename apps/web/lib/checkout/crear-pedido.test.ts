import { describe, expect, it } from 'vitest';
import { orderSummarySchema } from '@izao/core/schemas';
import { crearPedidoCheckout, type RespuestaPedido } from './crear-pedido';
import {
  AHORA,
  CIUDAD,
  CIUDAD_EC,
  ID_CODIGO,
  REGION,
  REGION_EC,
  V1,
  V2,
  V3,
  V4,
  fuenteDePrueba,
} from './pruebas/datos';
import type { FuenteMemoria } from './pruebas/fuente-memoria';

const CLAVE = '5f0c7a4e-8d1b-4c3a-9e2f-1a2b3c4d5e6f';
const CLAVE2 = '6f0c7a4e-8d1b-4c3a-9e2f-1a2b3c4d5e6f';

function cuerpo(p: Record<string, unknown> = {}) {
  return {
    country_code: 'CO',
    idempotency_key: CLAVE,
    items: [{ variant_id: V1, quantity: 1 }],
    contact: { first_name: 'María José', last_name: 'Gómez', phone: '300 123 4567', email: 'MJ@Ejemplo.com' },
    document: { type: 'CC', number: '1.020.304.050' },
    shipping: { region_id: REGION, city_id: CIUDAD, district: 'Laureles', address1: 'Calle 10 # 20-30', address2: null, notes: null },
    payment_method: 'wompi',
    discount_code: null,
    consents: { terms_and_data: true, whatsapp: true },
    data_policy_version: '2026-10',
    ...p,
  };
}

function exito(r: Awaited<ReturnType<typeof crearPedidoCheckout>>): RespuestaPedido {
  if (!r.ok) throw new Error(`se esperaba éxito: ${JSON.stringify(r.cuerpo)}`);
  return r.cuerpo;
}

function soloPedido(f: FuenteMemoria) {
  expect(f.pedidos.size).toBe(1);
  return [...f.pedidos.values()][0]!;
}

describe('POST /api/checkout: crear pedido', () => {
  it('Wompi: crea pendiente_pago con totales del servidor, reserva stock y registra el evento', async () => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(f, cuerpo({ items: [{ variant_id: V1, quantity: 2 }], discount_code: 'desc10' }), AHORA);
    expect(r.status).toBe(201);
    const c = exito(r);
    expect(orderSummarySchema.safeParse(c.order).success).toBe(true);
    expect(c.order).toMatchObject({
      number: 'IZ-CO-000001',
      status: 'pendiente_pago',
      currency_code: 'COP',
      payment_method: 'wompi',
      subtotal: '400000',
      discount: '40000',
      surcharge: '0',
      total_customer: '360000',
      cod_deposit: '0',
      cod_collect: '0',
    });
    expect(c.order.lines).toEqual([
      { name: 'Bruma Silvestre', variant_label: '100 ml', quantity: 2, unit_price: '200000', line_discount: '40000' },
    ]);
    expect(c).toMatchObject({ public_token: 'tok1', next_step: 'pay_wompi', status_path: '/co/pedido/tok1', repeated: false });

    const p = soloPedido(f);
    expect(p.fila).toMatchObject({
      country_code: 'CO',
      currency_code: 'COP',
      status: 'pendiente_pago',
      contact_first_name: 'María José',
      contact_phone_e164: '+573001234567',
      contact_email: 'mj@ejemplo.com',
      document_type: 'CC',
      document_number: '1020304050',
      shipping_region_name: 'Antioquia',
      shipping_city_name: 'Medellín',
      discount_code_id: ID_CODIGO(1),
      discount_amount: '40000',
      financing_surcharge_pct: '0.00',
      product_cost_total: '160000',
      checkout_idempotency_key: CLAVE,
      terms_accepted_at: AHORA.toISOString(),
      data_policy_version: '2026-10',
      whatsapp_opt_in: true,
    });
    expect(p.items[0]).toMatchObject({ sku: expect.any(String), unit_price: '200000', unit_cost: '80000', line_discount: '40000', quantity: 2 });
    expect(p.stock).toBe('reserved');
    expect(p.canje).toBe('reserved');
    expect(f.vars.get(V1)!.disponible).toBe(3);
    expect(f.eventos).toEqual([
      {
        orderId: p.pedido.id,
        evento: expect.objectContaining({ type: 'created', from_status: null, to_status: 'pendiente_pago', actor: 'system' }),
      },
    ]);
    // Orden de las operaciones: guardar antes de reservar; código después del stock
    const orden = f.llamadas.filter((x) => ['insertarPedido', 'insertarItems', 'reservarStock', 'reservarCanje'].includes(x));
    expect(orden).toEqual(['insertarPedido', 'insertarItems', 'reservarStock', 'reservarCanje']);
  });

  it('el navegador no puede mandar precios ni totales', async () => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(f, cuerpo({ items: [{ variant_id: V1, quantity: 1, unit_price: '1' }] }), AHORA);
    expect(r.status).toBe(400);
    const r2 = await crearPedidoCheckout(f, { ...cuerpo(), total_customer: '1' }, AHORA);
    expect(r2.status).toBe(400);
    expect(f.pedidos.size).toBe(0);
  });

  it('contra entrega: esperando_abono con abono y recaudo; exige autorización de WhatsApp', async () => {
    const f = fuenteDePrueba();
    const sinWa = await crearPedidoCheckout(
      f,
      cuerpo({ payment_method: 'cod', consents: { terms_and_data: true, whatsapp: false } }),
      AHORA,
    );
    expect(sinWa.status).toBe(400);
    const r = await crearPedidoCheckout(f, cuerpo({ payment_method: 'cod' }), AHORA);
    const c = exito(r);
    expect(c.order).toMatchObject({ status: 'esperando_abono', total_customer: '200000', cod_deposit: '20000', cod_collect: '180000' });
    expect(c.next_step).toBe('pay_cod_deposit');
  });

  it('contra entrega bajo el recaudo mínimo → METHOD_UNAVAILABLE COD_BELOW_MINIMUM', async () => {
    const f = fuenteDePrueba();
    f.vars.get(V1)!.precio = 60_000n;
    const r = await crearPedidoCheckout(f, cuerpo({ payment_method: 'cod' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 422, cuerpo: { error: 'METHOD_UNAVAILABLE', reason: 'COD_BELOW_MINIMUM' } });
    expect(f.pedidos.size).toBe(0);
  });

  it('Addi retira el código, aplica el recargo y avisa', async () => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(f, cuerpo({ payment_method: 'addi', discount_code: 'DESC10' }), AHORA);
    const c = exito(r);
    expect(c.order).toMatchObject({ status: 'pendiente_pago', discount: '0', surcharge: '20000', total_customer: '220000' });
    expect(c.warnings).toContain('DISCOUNT_NOT_ALLOWED_WITH_FINANCING');
    expect(c.next_step).toBe('pay_addi');
    const p = soloPedido(f);
    expect(p.fila).toMatchObject({ discount_code_id: null, financing_surcharge_pct: '10.00', financing_surcharge_amount: '20000' });
    expect(p.canje).toBe('none');
  });

  it('Sistecrédito con porcentaje decimal (12,5 %) redondea medio hacia arriba', async () => {
    const f = fuenteDePrueba();
    f.vars.get(V1)!.precio = 199_999n;
    const c = exito(await crearPedidoCheckout(f, cuerpo({ payment_method: 'sistecredito' }), AHORA));
    // 199999 × 12,5 % = 24999,875 → 25000
    expect(c.order).toMatchObject({ surcharge: '25000', total_customer: '224999' });
    expect(soloPedido(f).fila.financing_surcharge_pct).toBe('12.50');
  });

  it('método inactivo del país → 400 en payment_method', async () => {
    const f = fuenteDePrueba();
    const cfg = f.config.get('CO')!;
    f.config.set('CO', { ...cfg, metodos: cfg.metodos.map((m) => (m.method === 'sistecredito' ? { ...m, is_enabled: false } : m)) });
    const r = await crearPedidoCheckout(f, cuerpo({ payment_method: 'sistecredito' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 400, cuerpo: { error: 'INVALID_INPUT' } });
    if (!r.ok) expect(r.cuerpo.issues?.map((i) => i.path)).toContainEqual('payment_method');
    const manual = await crearPedidoCheckout(f, cuerpo({ payment_method: 'manual' }), AHORA);
    expect(manual.status).toBe(400);
  });

  it('Ecuador sin métodos activos: pedido manual en USD', async () => {
    const f = fuenteDePrueba();
    const base = cuerpo({
      country_code: 'EC',
      items: [{ variant_id: V4, quantity: 2 }],
      contact: { first_name: 'Ana', last_name: 'Paz', phone: '0991234567', email: null },
      document: { type: 'CEDULA', number: '1712345678' },
      shipping: { region_id: REGION_EC, city_id: CIUDAD_EC, district: null, address1: 'Av. Amazonas 123', address2: null, notes: null },
    });
    expect((await crearPedidoCheckout(f, { ...base, payment_method: 'wompi' }, AHORA)).status).toBe(400);
    const c = exito(await crearPedidoCheckout(f, { ...base, payment_method: 'manual' }, AHORA));
    expect(c.order).toMatchObject({ status: 'pendiente_manual', currency_code: 'USD', subtotal: '9998', total_customer: '9998' });
    expect(c.next_step).toBe('manual_whatsapp');
    expect(c.status_path).toBe('/ec/pedido/tok1');
  });

  it('idempotencia: el mismo envío devuelve el mismo pedido sin crear otro', async () => {
    const f = fuenteDePrueba();
    const a = exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r.status).toBe(200);
    const b = exito(r);
    expect(b.repeated).toBe(true);
    expect(b.order.number).toBe(a.order.number);
    expect(f.pedidos.size).toBe(1);
    expect(f.vars.get(V1)!.disponible).toBe(4);
  });

  it('idempotencia: misma clave en otro país → 409', async () => {
    const f = fuenteDePrueba();
    exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
    const r = await crearPedidoCheckout(
      f,
      cuerpo({
        country_code: 'EC',
        payment_method: 'manual',
        items: [{ variant_id: V4, quantity: 1 }],
        contact: { first_name: 'Ana', last_name: 'Paz', phone: '0991234567', email: null },
        document: { type: 'CEDULA', number: '1712345678' },
        shipping: { region_id: REGION_EC, city_id: CIUDAD_EC, district: null, address1: 'Av. Amazonas 123', address2: null, notes: null },
      }),
      AHORA,
    );
    expect(r).toMatchObject({ ok: false, status: 409, cuerpo: { error: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('doble clic simultáneo: la clave única de la base resuelve al pedido ya creado', async () => {
    const f = fuenteDePrueba();
    exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
    // Simula que la lectura previa no lo vio (carrera) y la inserción choca con la clave única
    const original = f.pedidoPorIdempotencia.bind(f);
    let primera = true;
    f.pedidoPorIdempotencia = async (k: string) => {
      if (primera) {
        primera = false;
        return null;
      }
      return original(k);
    };
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r.status).toBe(200);
    expect(exito(r).repeated).toBe(true);
    expect(f.pedidos.size).toBe(1);
  });

  it('sin stock suficiente antes de guardar → 409 STOCK_CHANGED con max_quantity, sin pedido', async () => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(
      f,
      cuerpo({ items: [{ variant_id: V1, quantity: 1 }, { variant_id: V2, quantity: 2 }, { variant_id: V3, quantity: 1 }] }),
      AHORA,
    );
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      cuerpo: { error: 'STOCK_CHANGED', lines: [{ variant_id: V2, max_quantity: 1 }, { variant_id: V3, max_quantity: 0 }] },
    });
    expect(f.llamadas).not.toContain('insertarPedido');
  });

  it('carrera por el último producto: reservar_stock falla → se deshace el pedido y responde 409', async () => {
    const f = fuenteDePrueba();
    const leer = f.variantes.bind(f);
    f.variantes = async (pais, ids) => {
      const m = await leer(pais, ids);
      f.vars.get(V2)!.disponible = 0; // otro cliente reservó entre la lectura y la reserva
      return m;
    };
    const r = await crearPedidoCheckout(f, cuerpo({ items: [{ variant_id: V2, quantity: 1 }], discount_code: 'DESC10' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 409, cuerpo: { error: 'STOCK_CHANGED', lines: [{ variant_id: V2, max_quantity: 0 }] } });
    expect(f.pedidos.size).toBe(0);
    expect(f.eliminados).toHaveLength(1);
    expect(f.llamadas).not.toContain('reservarCanje');
    expect(f.codigos.find((c) => c.code === 'DESC10')!.usage_count).toBe(0);
  });

  it.each([
    ['VENCIDO', 'CODE_EXPIRED'],
    ['INACTIVO', 'CODE_INVALID'],
    ['OTROPAIS', 'CODE_INVALID'],
    ['NOEXISTE', 'CODE_INVALID'],
  ])('código %s al pagar → 422 CODE_REJECTED %s, sin pedido', async (codigo, motivo) => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: codigo }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 422, cuerpo: { error: 'CODE_REJECTED', reason: motivo } });
    expect(f.pedidos.size).toBe(0);
  });

  it('límite por cliente: se verifica con documento, celular y correo antes de guardar', async () => {
    const f = fuenteDePrueba();
    f.usosPrevios = 1;
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: 'UNOXCLIENTE' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 422, cuerpo: { error: 'CODE_REJECTED', reason: 'CODE_LIMIT_REACHED' } });
    expect(f.pedidos.size).toBe(0);
  });

  it('reservar_canje rechaza (cupo agotado en carrera) → libera stock, deshace y responde 422', async () => {
    const f = fuenteDePrueba();
    f.canjeRechazo = 'limite_total';
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 422, cuerpo: { error: 'CODE_REJECTED', reason: 'CODE_LIMIT_REACHED' } });
    expect(f.pedidos.size).toBe(0);
    expect(f.vars.get(V1)!.disponible).toBe(5);
  });

  it('falla al guardar las líneas → deshace el pedido y responde 503', async () => {
    const f = fuenteDePrueba();
    f.fallar.add('insertarItems');
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r).toMatchObject({ ok: false, status: 503, cuerpo: { error: 'UNAVAILABLE' } });
    expect(f.pedidos.size).toBe(0);
  });

  it('si no se puede liberar, el pedido no se borra: lo vence pedidos_por_vencer', async () => {
    const f = fuenteDePrueba();
    f.canjeRechazo = 'limite_total';
    f.fallar.add('liberarStock');
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA);
    expect(r.status).toBe(503);
    expect(f.eliminados).toHaveLength(0);
    expect(soloPedido(f).stock).toBe('reserved');
  });

  it('un pedido a medias con la misma clave no se entrega como creado → 409 CHECKOUT_IN_PROGRESS', async () => {
    const f = fuenteDePrueba();
    f.canjeRechazo = 'limite_total';
    f.fallar.add('liberarStock');
    await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA);
    f.fallar.clear();
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 409, cuerpo: { error: 'CHECKOUT_IN_PROGRESS' } });
  });

  it('ciudad que no es de la región o del país → 422 SHIPPING_LOCATION_INVALID', async () => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(
      f,
      cuerpo({ shipping: { region_id: REGION, city_id: CIUDAD_EC, district: null, address1: 'Calle 1 # 2-3', address2: null, notes: null } }),
      AHORA,
    );
    expect(r).toMatchObject({ ok: false, status: 422, cuerpo: { error: 'SHIPPING_LOCATION_INVALID' } });
  });

  it('errores de validación no devuelven los datos enviados', async () => {
    const f = fuenteDePrueba();
    const r = await crearPedidoCheckout(f, cuerpo({ contact: { first_name: 'Ana', last_name: 'Paz', phone: '12345', email: null } }), AHORA);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.cuerpo)).not.toContain('12345');
    expect((await crearPedidoCheckout(f, 'no es json', AHORA)).status).toBe(400);
    expect((await crearPedidoCheckout(f, { country_code: 'PE' }, AHORA)).status).toBe(400);
  });

  it('país sin configuración → 503 sin crear nada', async () => {
    const f = fuenteDePrueba();
    f.config.delete('CO');
    expect((await crearPedidoCheckout(f, cuerpo({ idempotency_key: CLAVE2 }), AHORA)).status).toBe(503);
  });
});
