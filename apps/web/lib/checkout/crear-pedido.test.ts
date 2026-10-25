import { describe, expect, it } from 'vitest';
import { orderSummarySchema } from '@izao/core/schemas';
import { COOKIE_CLICK_IDS, COOKIE_REF, COOKIE_UTM, serializarClickIds, serializarUtm } from '@/lib/store/atribucion/captura';
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
    // Una sola escritura: crear_pedido_checkout hace pedido, líneas, stock, canje y evento en una transacción
    expect(f.llamadas.filter((x) => x === 'crearPedido')).toEqual(['crearPedido']);
    expect(r.ok && r.order_id).toBe(p.pedido.id);
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

  it('financiación con porcentaje decimal (12,5 %) redondea medio hacia arriba', async () => {
    const f = fuenteDePrueba();
    const cfg = f.config.get('CO')!;
    f.config.set('CO', {
      ...cfg,
      ajustes: { ...cfg.ajustes, financing_surcharge_pct: { ...cfg.ajustes.financing_surcharge_pct, addi: '12.5' } },
    });
    f.vars.get(V1)!.precio = 199_999n;
    const c = exito(await crearPedidoCheckout(f, cuerpo({ payment_method: 'addi' }), AHORA));
    // 199999 × 12,5 % = 24999,875 → 25000
    expect(c.order).toMatchObject({ surcharge: '25000', total_customer: '224999' });
    expect(soloPedido(f).fila.financing_surcharge_pct).toBe('12.50');
  });

  it('Sistecrédito activo en el panel pero pendiente de documentación → 400 en payment_method, sin pedido (D-032)', async () => {
    const f = fuenteDePrueba();
    expect(f.config.get('CO')!.metodos.find((m) => m.method === 'sistecredito')?.is_enabled).toBe(true);
    const r = await crearPedidoCheckout(f, cuerpo({ payment_method: 'sistecredito' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 400, cuerpo: { error: 'INVALID_INPUT' } });
    if (!r.ok) expect(r.cuerpo.issues?.map((i) => i.path)).toContainEqual('payment_method');
    expect(f.pedidos.size).toBe(0);
    expect(f.llamadas).not.toContain('crearPedido');
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

  it('carrera por el último producto: la base rechaza sin escribir nada y responde 409', async () => {
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
    expect(f.eventos).toHaveLength(0);
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

  it('reservar_canje rechaza (cupo agotado en carrera) → nada escrito, stock intacto y 422', async () => {
    const f = fuenteDePrueba();
    f.canjeRechazo = 'limite_total';
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA);
    expect(r).toMatchObject({ ok: false, status: 422, cuerpo: { error: 'CODE_REJECTED', reason: 'CODE_LIMIT_REACHED' } });
    expect(f.pedidos.size).toBe(0);
    expect(f.vars.get(V1)!.disponible).toBe(5);
  });

  it('error de la base al crear → 503 y nada escrito (la transacción se deshace sola)', async () => {
    const f = fuenteDePrueba();
    f.fallar.add('crearPedido');
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r).toMatchObject({ ok: false, status: 503, cuerpo: { error: 'UNAVAILABLE' } });
    expect(f.pedidos.size).toBe(0);
  });

  it('otra petición con la misma clave a mitad de camino → 409 CHECKOUT_IN_PROGRESS', async () => {
    const f = fuenteDePrueba();
    f.enProceso = true;
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r).toMatchObject({ ok: false, status: 409, cuerpo: { error: 'CHECKOUT_IN_PROGRESS' } });
  });

  it('la base detecta la repetición pero no se puede releer el pedido → 409 CHECKOUT_IN_PROGRESS (no se confirma a ciegas)', async () => {
    const f = fuenteDePrueba();
    await crearPedidoCheckout(f, cuerpo(), AHORA);
    f.pedidoPorIdempotencia = async () => null; // ninguna lectura lo ve
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r).toMatchObject({ ok: false, status: 409, cuerpo: { error: 'CHECKOUT_IN_PROGRESS' } });
    expect(f.pedidos.size).toBe(1);
  });

  describe('idempotencia con contenido distinto', () => {
    it.each<[string, Record<string, unknown>]>([
      ['otra cantidad', { items: [{ variant_id: V1, quantity: 2 }] }],
      ['otra línea', { items: [{ variant_id: V1, quantity: 1 }, { variant_id: V2, quantity: 1 }] }],
      ['otro método', { payment_method: 'cod' }],
      ['un código', { discount_code: 'DESC10' }],
      [
        'otra dirección',
        { shipping: { region_id: REGION, city_id: CIUDAD, district: 'Laureles', address1: 'Carrera 70 # 1-2', address2: null, notes: null } },
      ],
    ])('misma clave con %s → 409 IDEMPOTENCY_CONFLICT sin crear otro pedido', async (_n, cambio) => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      const r = await crearPedidoCheckout(f, cuerpo(cambio), AHORA);
      expect(r).toEqual({ ok: false, status: 409, cuerpo: { error: 'IDEMPOTENCY_CONFLICT' } });
      expect(f.pedidos.size).toBe(1);
      expect(f.llamadas.filter((x) => x === 'crearPedido')).toHaveLength(1);
    });

    it('mismo contenido con otro orden de líneas, mayúsculas en el código o espacios → 200 repeated', async () => {
      const f = fuenteDePrueba();
      const items = [{ variant_id: V1, quantity: 1 }, { variant_id: V2, quantity: 1 }];
      exito(await crearPedidoCheckout(f, cuerpo({ items, discount_code: 'DESC10' }), AHORA));
      const r = await crearPedidoCheckout(f, cuerpo({ items: [...items].reverse(), discount_code: ' desc10 ' }), AHORA);
      expect(r.status).toBe(200);
      expect(exito(r).repeated).toBe(true);
    });

    it('Addi retira el código: el reintento con el mismo código es el mismo pedido', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo({ payment_method: 'addi', discount_code: 'DESC10' }), AHORA));
      const r = await crearPedidoCheckout(f, cuerpo({ payment_method: 'addi', discount_code: 'DESC10' }), AHORA);
      expect(r.status).toBe(200);
      const r2 = await crearPedidoCheckout(f, cuerpo({ payment_method: 'addi', discount_code: null }), AHORA);
      expect(r2.status).toBe(200);
    });

    it('carrera: la base devuelve el pedido existente y su contenido difiere → 409 IDEMPOTENCY_CONFLICT', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      const original = f.pedidoPorIdempotencia.bind(f);
      let primera = true;
      f.pedidoPorIdempotencia = async (k: string) => {
        if (primera) {
          primera = false;
          return null;
        }
        return original(k);
      };
      const r = await crearPedidoCheckout(f, cuerpo({ items: [{ variant_id: V1, quantity: 3 }] }), AHORA);
      expect(r).toEqual({ ok: false, status: 409, cuerpo: { error: 'IDEMPOTENCY_CONFLICT' } });
      expect(f.pedidos.size).toBe(1);
      expect(f.vars.get(V1)!.disponible).toBe(4);
    });

    it('la fila del pedido lleva la huella (checkout_request_hash) que la base guarda y compara', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      expect(soloPedido(f).fila.checkout_request_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('la huella persistida manda: si difiere de la del reintento → 409 aunque el contenido releído coincida', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      soloPedido(f).fila.checkout_request_hash = 'f'.repeat(64);
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r).toEqual({ ok: false, status: 409, cuerpo: { error: 'IDEMPOTENCY_CONFLICT' } });
    });

    it('pedido anterior sin huella guardada: se compara el contenido persistido (200 repeated)', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      soloPedido(f).fila.checkout_request_hash = null;
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r.status).toBe(200);
      const r2 = await crearPedidoCheckout(f, cuerpo({ items: [{ variant_id: V1, quantity: 2 }] }), AHORA);
      expect(r2).toEqual({ ok: false, status: 409, cuerpo: { error: 'IDEMPOTENCY_CONFLICT' } });
    });

    it('la base rechaza idempotencia_conflicto (huellas distintas en carrera) → 409 sin escribir', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      f.pedidoPorIdempotencia = async () => null; // la lectura previa no lo ve
      const r = await crearPedidoCheckout(f, cuerpo({ items: [{ variant_id: V1, quantity: 2 }] }), AHORA);
      expect(r).toEqual({ ok: false, status: 409, cuerpo: { error: 'IDEMPOTENCY_CONFLICT' } });
      expect(f.pedidos.size).toBe(1);
      expect(f.vars.get(V1)!.disponible).toBe(4);
    });
  });

  describe('versión de la política de datos', () => {
    it('versión distinta de la vigente → 409 DATA_POLICY_OUTDATED con la vigente, sin pedido', async () => {
      const f = fuenteDePrueba();
      const r = await crearPedidoCheckout(f, cuerpo({ data_policy_version: '1999-01' }), AHORA);
      expect(r).toEqual({ ok: false, status: 409, cuerpo: { error: 'DATA_POLICY_OUTDATED', current_version: '2026-10' } });
      expect(f.pedidos.size).toBe(0);
      expect(f.llamadas).not.toContain('crearPedido');
    });

    it('se guarda la versión vigente leída de la base (espacios del navegador no cuentan)', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo({ data_policy_version: ' 2026-10 ' }), AHORA));
      expect(soloPedido(f).fila.data_policy_version).toBe('2026-10');
    });

    it('la vigente es por país', async () => {
      const f = fuenteDePrueba();
      f.politicas.set('CO', '7');
      const r = await crearPedidoCheckout(f, cuerpo({ data_policy_version: '2026-10' }), AHORA);
      expect(r).toMatchObject({ status: 409, cuerpo: { error: 'DATA_POLICY_OUTDATED', current_version: '7' } });
      exito(await crearPedidoCheckout(f, cuerpo({ data_policy_version: '7' }), AHORA));
    });

    it('sin política de datos publicada en el país → 503 sin pedido (no hay consentimiento válido)', async () => {
      const f = fuenteDePrueba();
      f.politicas.delete('CO');
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r).toEqual({ ok: false, status: 503, cuerpo: { error: 'UNAVAILABLE' } });
      expect(f.pedidos.size).toBe(0);
    });

    it('la política cambia entre la lectura y la escritura: la base rechaza → 409 con la versión de la base, nada escrito', async () => {
      const f = fuenteDePrueba();
      f.versionPoliticaDatos = async () => '2026-10'; // lectura previa (vieja)
      f.politicas.set('CO', '2026-11'); // lo que la base exige al escribir
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r).toEqual({ ok: false, status: 409, cuerpo: { error: 'DATA_POLICY_OUTDATED', current_version: '2026-11' } });
      expect(f.pedidos.size).toBe(0);
      expect(f.vars.get(V1)!.disponible).toBe(5);
    });

    it('politica_datos_desactualizada sin version_vigente → 503 (la versión no se inventa)', async () => {
      const f = fuenteDePrueba();
      f.crearPedido = async () => ({ ok: false, motivo: 'politica_datos_desactualizada' });
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r).toEqual({ ok: false, status: 503, cuerpo: { error: 'UNAVAILABLE' } });
    });

    it('la política se despublica entre la lectura y la escritura: la base responde sin_politica_datos → 503', async () => {
      const f = fuenteDePrueba();
      f.versionPoliticaDatos = async () => '2026-10';
      f.politicas.delete('CO');
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r).toEqual({ ok: false, status: 503, cuerpo: { error: 'UNAVAILABLE' } });
      expect(f.pedidos.size).toBe(0);
    });

    it('un reintento de un pedido ya creado responde el pedido aunque la política haya cambiado después', async () => {
      const f = fuenteDePrueba();
      exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
      f.politicas.set('CO', '2026-11');
      const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
      expect(r.status).toBe(200);
    });
  });

  it('totales rechazados por la base (totales_inconsistentes/datos_invalidos) → 503 sin detalles', async () => {
    const f = fuenteDePrueba();
    f.crearPedido = async () => ({ ok: false, motivo: 'totales_inconsistentes' });
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA);
    expect(r).toEqual({ ok: false, status: 503, cuerpo: { error: 'UNAVAILABLE' } });
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

describe('atribución del pedido (influencer, UTM y click IDs desde las cookies)', () => {
  const INF_ANA = 'a1000000-0000-4000-8000-000000000001';
  const INF_DESC = 'a1000000-0000-4000-8000-000000000002';
  const INF_EC = 'a1000000-0000-4000-8000-000000000003';
  const INF_INACTIVO = 'a1000000-0000-4000-8000-000000000004';
  const UTM = { utm_source: 'instagram', utm_campaign: 'navidad' };
  const CLK = { fbclid: 'IwAR123' };

  const galleta = (p: { ref?: string; utm?: Record<string, string>; clk?: Record<string, string> }) =>
    [
      p.ref ? `${COOKIE_REF}=${p.ref}` : '',
      p.utm ? `${COOKIE_UTM}=${encodeURIComponent(serializarUtm(p.utm))}` : '',
      p.clk ? `${COOKIE_CLICK_IDS}=${encodeURIComponent(serializarClickIds(p.clk))}` : '',
    ]
      .filter(Boolean)
      .join('; ');

  function conInfluencers() {
    const f = fuenteDePrueba();
    const base = f.codigos.find((c) => c.code === 'DESC10')!;
    f.codigos.push(
      { ...base, id: ID_CODIGO(9).replace(/9$/, 'a'), code: 'ANA10' },
      { ...base, id: ID_CODIGO(9).replace(/9$/, 'b'), code: 'ANAEC', country_code: 'EC' },
      { ...base, id: ID_CODIGO(9).replace(/9$/, 'c'), code: 'ANAOFF', is_active: false },
      { ...base, id: ID_CODIGO(9).replace(/9$/, 'd'), code: 'INFOFF' },
    );
    f.influencerPorCodigo.set('ANA10', INF_ANA).set('DESC10', INF_DESC).set('ANAEC', INF_EC).set('ANAOFF', INF_ANA).set('INFOFF', INF_INACTIVO);
    f.influencers
      .set(INF_ANA, { pais: 'CO', activo: true })
      .set(INF_DESC, { pais: 'CO', activo: true })
      .set(INF_EC, { pais: 'EC', activo: true })
      .set(INF_INACTIVO, { pais: 'CO', activo: false });
    return f;
  }

  it('ref de la cookie con influencer activo del país, UTM y click IDs → van a la fila del pedido', async () => {
    const f = conInfluencers();
    exito(await crearPedidoCheckout(f, cuerpo(), AHORA, { cookie: galleta({ ref: 'ANA10', utm: UTM, clk: CLK }) }));
    expect(soloPedido(f).fila).toMatchObject({ influencer_id: INF_ANA, utm: UTM, click_ids: CLK });
  });

  it('el influencer del código aplicado gana sobre el ref de la cookie', async () => {
    const f = conInfluencers();
    exito(await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA, { cookie: galleta({ ref: 'ANA10' }) }));
    expect(soloPedido(f).fila.influencer_id).toBe(INF_DESC);
  });

  it.each(['ANAEC', 'ANAOFF', 'INFOFF', 'NOEXISTE', 'mal<formato>'])('ref %s (otro país, inactivo o inexistente) → sin influencer', async (ref) => {
    const f = conInfluencers();
    exito(await crearPedidoCheckout(f, cuerpo(), AHORA, { cookie: galleta({ ref }) }));
    expect(soloPedido(f).fila.influencer_id).toBeNull();
  });

  it('sin cookies: influencer null y objetos vacíos', async () => {
    const f = conInfluencers();
    exito(await crearPedidoCheckout(f, cuerpo(), AHORA));
    expect(soloPedido(f).fila).toMatchObject({ influencer_id: null, utm: {}, click_ids: {} });
  });

  it('si la búsqueda del influencer falla, el pedido se crea igual sin influencer', async () => {
    const f = conInfluencers();
    f.fallar.add('influencerDeCodigo');
    const r = await crearPedidoCheckout(f, cuerpo({ discount_code: 'DESC10' }), AHORA, { cookie: galleta({ ref: 'ANA10', utm: UTM }) });
    expect(r.status).toBe(201);
    expect(soloPedido(f).fila).toMatchObject({ influencer_id: null, utm: UTM });
  });

  it('con financiación el código se retira: no atribuye por él, sí por la cookie', async () => {
    const f = conInfluencers();
    exito(await crearPedidoCheckout(f, cuerpo({ payment_method: 'addi', discount_code: 'DESC10' }), AHORA, { cookie: galleta({ ref: 'ANA10' }) }));
    expect(soloPedido(f).fila.influencer_id).toBe(INF_ANA);
  });

  it('la atribución no entra en la huella: misma clave con otras cookies → 200 repeated', async () => {
    const f = conInfluencers();
    exito(await crearPedidoCheckout(f, cuerpo(), AHORA, { cookie: galleta({ ref: 'ANA10' }) }));
    const r = await crearPedidoCheckout(f, cuerpo(), AHORA, { cookie: galleta({ utm: UTM }) });
    expect(r.status).toBe(200);
    expect(f.pedidos.size).toBe(1);
  });
});
