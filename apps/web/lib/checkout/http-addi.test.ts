import { describe, expect, it, vi } from 'vitest';
import { crearClienteAddi, type AddiCredentials } from '@izao/addi';
import { CREDENCIALES_ADDI_PRUEBA, fetchAddiFalso, type RespuestaSolicitudFalsa } from '@izao/addi/mock';
import { fromDbAmount } from '@izao/core/money';
import { manejarCheckout, manejarPago, type DepsPagos } from './http';
import { crearLimitadorMemoria } from './limite-tasa';
import type { FuentePagosAddi, IntentoAddi, PedidoAddiParaPago } from './pago-addi';
import type { FuentePagos, PedidoParaPago } from './pago-wompi';
import { AHORA, CIUDAD, REGION, V1, fuenteDePrueba } from './pruebas/datos';
import type { FuenteMemoria } from './pruebas/fuente-memoria';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** Fuentes de pago (Wompi y Addi) sobre los pedidos que guardó la fuente en memoria del checkout. */
function pagosSobre(mem: FuenteMemoria, o: { solicitud?: RespuestaSolicitudFalsa; creds?: AddiCredentials | null } = {}) {
  const intentos: (IntentoAddi & { order_id: string })[] = [];
  const red = fetchAddiFalso({ solicitud: o.solicitud ?? 'redirige' });
  const vence = new Date(AHORA.getTime() + 60 * 60_000);
  const g0 = () => [...mem.pedidos.entries()][0];
  const pedidoAddi = (id: string): PedidoAddiParaPago | null => {
    const g = mem.pedidos.get(id);
    if (!g) return null;
    const fila = g.fila as unknown as Record<string, string | null>;
    const v = (k: string): string | null => fila[k] ?? null;
    const t = (k: string): string => String(fila[k]);
    return {
      id,
      number: g.pedido.number,
      public_token: TOKEN,
      status: g.pedido.status,
      payment_method: g.pedido.payment_method,
      country_code: g.pedido.country_code,
      currency_code: g.pedido.currency_code,
      subtotal: fromDbAmount(t('subtotal')),
      discount_amount: fromDbAmount(t('discount_amount')),
      financing_surcharge_amount: fromDbAmount(t('financing_surcharge_amount')),
      total_customer: g.pedido.total_customer,
      contact_first_name: t('contact_first_name'),
      contact_last_name: t('contact_last_name'),
      contact_email: v('contact_email'),
      contact_phone_e164: t('contact_phone_e164'),
      document_type: v('document_type'),
      document_number: v('document_number'),
      shipping_address1: v('shipping_address1'),
      shipping_address2: v('shipping_address2'),
      shipping_city_name: v('shipping_city_name'),
      stock_reserved_until: vence,
      items: g.items.map((i) => ({
        sku: String(i.sku),
        name: String(i.name_snapshot),
        variant_label: (i.variant_label as string | null) ?? null,
        quantity: Number(i.quantity),
        unit_price: fromDbAmount(String(i.unit_price)),
        line_discount: fromDbAmount(String(i.line_discount)),
      })),
    };
  };
  const addi: FuentePagosAddi = {
    pedidoAddiPorId: async (id) => pedidoAddi(id),
    intentosAddi: async (id) => intentos.filter((i) => i.order_id === id).map((i) => ({ ...i })),
    credencialesAddi: async () => (o.creds === undefined ? CREDENCIALES_ADDI_PRUEBA : o.creds),
    insertarIntentoAddi: async (n) => {
      const i = { id: `p${intentos.length + 1}`, order_id: n.order_id, status: 'created' as const, amount: n.amount, provider_reference: n.provider_reference, checkout_url: null, expires_at: n.expires_at, created_at: AHORA };
      intentos.push(i);
      return { ok: true, intento: { ...i } };
    },
    completarIntentoAddi: async (id, c) => {
      const i = intentos.find((x) => x.id === id)!;
      i.status = c.status;
      i.checkout_url = c.checkout_url;
    },
    aplicarTransicion: async (id, ev) => {
      const g = mem.pedidos.get(id)!;
      if (g.pedido.status !== ev.from_status) return false;
      g.pedido.status = ev.to_status;
      return true;
    },
  };
  const aPedido = (id: string): PedidoParaPago | null => {
    const p = pedidoAddi(id);
    return p ? { ...p, stock_reserved_until: vence } : null;
  };
  const wompi: FuentePagos = {
    pedidoPorId: async (id) => aPedido(id),
    pedidoPorToken: async (_p, t) => (t === TOKEN && g0() ? aPedido(g0()![0]) : null),
    intentosWompi: async () => [],
    credencialesWompi: async () => null,
    insertarIntento: async () => {
      throw new Error('no debe crear intentos de Wompi');
    },
    aplicarTransicion: async () => true,
  };
  const pagos: DepsPagos = {
    fuente: () => wompi,
    urlSitio: 'https://izaoperfumeria.com',
    addi: () => addi,
    clienteAddi: (c) => crearClienteAddi({ credenciales: c, fetchImpl: red.fetch }),
  };
  return { pagos, intentos, red };
}

function req(url: string, cuerpo: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '10.0.0.9' },
    body: JSON.stringify(cuerpo),
  });
}

const checkout = {
  country_code: 'CO',
  idempotency_key: '7f0c7a4e-8d1b-4c3a-9e2f-1a2b3c4d5e6f',
  items: [{ variant_id: V1, quantity: 1 }],
  contact: { first_name: 'Ana', last_name: 'Paz', phone: '3001234567', email: 'ana@example.com' },
  document: { type: 'CC', number: '1020304050' },
  shipping: { region_id: REGION, city_id: CIUDAD, district: null, address1: 'Calle 1 # 2-3', address2: null, notes: null },
  payment_method: 'addi',
  discount_code: 'DESC10',
  consents: { terms_and_data: true, whatsapp: false },
  data_policy_version: '2026-10',
};

const limitador = () => crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });

describe('checkout con Addi (§12.3): recargo, sin código y solicitud lista', () => {
  it('201 con recargo del 10 %, código retirado con aviso y payment con la URL https de Addi', async () => {
    const mem = fuenteDePrueba();
    const { pagos, intentos, red } = pagosSobre(mem);
    const res = await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador: limitador(), ahora: () => AHORA, pagos });
    expect(res.status).toBe(201);
    const j = (await res.json()) as {
      next_step: string;
      warnings: string[];
      order: { discount: string; surcharge: string; total_customer: string };
      payment: { checkout_url: string; expires_at: string } | null;
    };
    expect(j.next_step).toBe('pay_addi');
    expect(j.order).toMatchObject({ discount: '0', surcharge: '20000', total_customer: '220000' });
    expect(j.warnings).toContain('DISCOUNT_NOT_ALLOWED_WITH_FINANCING');
    expect(j.payment).toEqual({
      checkout_url: 'https://checkout.addi-staging.com/aplicacion/IZ-CO-000001-A1',
      expires_at: new Date(AHORA.getTime() + 3_600_000).toISOString(),
    });
    // A Addi va el total con recargo; el pago queda registrado con el mismo monto.
    const solicitud = red.llamadas.find((l) => l.url.endsWith('/v1/online-applications'))!;
    expect((solicitud.body as { totalAmount: string }).totalAmount).toBe('220000.0');
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({ amount: 220_000n, provider_reference: 'IZ-CO-000001-A1' });
    expect(JSON.stringify(j)).not.toContain(CREDENCIALES_ADDI_PRUEBA.clientSecret);
    expect(JSON.stringify(j)).not.toContain('"order_id"');
  });

  it('Addi caído: el pedido se crea igual (201) con payment = null', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mem = fuenteDePrueba();
    const { pagos } = pagosSobre(mem, { solicitud: 'caida' });
    const res = await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador: limitador(), ahora: () => AHORA, pagos });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { payment: unknown }).payment).toBeNull();
    error.mockRestore();
  });

  it('documento distinto de cédula de ciudadanía → 400 antes de crear el pedido (Addi solo acepta CC)', async () => {
    const mem = fuenteDePrueba();
    const { pagos, red } = pagosSobre(mem);
    const res = await manejarCheckout(req('/api/checkout', { ...checkout, document: { type: 'CE', number: '1020304' } }), {
      fuente: () => mem,
      limitador: limitador(),
      ahora: () => AHORA,
      pagos,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'INVALID_INPUT', issues: [{ path: 'document.type' }] });
    expect(mem.pedidos.size).toBe(0);
    expect(red.llamadas).toHaveLength(0);
  });
});

describe('POST /api/checkout/pago con un pedido de Addi', () => {
  async function conPedido(o: { solicitud?: RespuestaSolicitudFalsa } = {}) {
    const mem = fuenteDePrueba();
    const p = pagosSobre(mem, o);
    // Sin `pagos` en la creación: el pedido queda sin solicitud y la página la pide aparte.
    await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador: limitador(), ahora: () => AHORA });
    return { mem, ...p };
  }

  it('200 con la URL de Addi; repetir la reutiliza sin crear otra solicitud', async () => {
    const { pagos, red } = await conPedido();
    const deps = { pagos, limitador: limitador(), ahora: () => AHORA };
    const r1 = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN }), deps);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ checkout_url: 'https://checkout.addi-staging.com/aplicacion/IZ-CO-000001-A1', reused: false });
    const r2 = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN }), deps);
    expect(await r2.json()).toMatchObject({ reused: true });
    expect(red.llamadas.filter((l) => l.url.endsWith('/v1/online-applications'))).toHaveLength(1);
  });

  it('cliente con crédito vigente en Addi → 409 rechazado_entidad y el pedido pasa a pago_rechazado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pagos, mem } = await conPedido({ solicitud: 'conflicto' });
    const res = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN }), { pagos, limitador: limitador(), ahora: () => AHORA });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'PAYMENT_NOT_AVAILABLE', reason: 'rechazado_entidad' });
    expect([...mem.pedidos.values()][0]!.pedido.status).toBe('pago_rechazado');
    error.mockRestore();
  });

  it('sin fuente de Addi configurada → 409 metodo (nunca cae a Wompi)', async () => {
    const { pagos } = await conPedido();
    const sinAddi: DepsPagos = { fuente: pagos.fuente, urlSitio: pagos.urlSitio };
    const res = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN }), { pagos: sinAddi, limitador: limitador(), ahora: () => AHORA });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'PAYMENT_NOT_AVAILABLE', reason: 'metodo' });
  });
});
