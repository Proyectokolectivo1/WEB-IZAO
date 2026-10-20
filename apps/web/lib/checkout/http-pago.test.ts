import { describe, expect, it } from 'vitest';
import type { WompiCredentials } from '@izao/wompi';
import { manejarCheckout, manejarPago, type DepsPagos } from './http';
import { crearLimitadorMemoria } from './limite-tasa';
import type { FuentePagos, IntentoPago, PedidoParaPago } from './pago-wompi';
import { AHORA, CIUDAD, REGION, V1, fuenteDePrueba } from './pruebas/datos';
import type { FuenteMemoria } from './pruebas/fuente-memoria';

const CREDS: WompiCredentials = {
  ambiente: 'sandbox',
  llavePublica: 'pub_test_ficticia',
  llavePrivada: 'prv_test_ficticia',
  secretoEventos: 'test_events_ficticio',
  secretoIntegridad: 'test_integrity_ficticio',
};
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** FuentePagos sobre los pedidos de la fuente en memoria del checkout. */
function pagosSobre(mem: FuenteMemoria, creds: WompiCredentials | null = CREDS) {
  const intentos: (IntentoPago & { order_id: string })[] = [];
  const aPedido = (id: string): PedidoParaPago | null => {
    const g = mem.pedidos.get(id);
    if (!g) return null;
    return {
      id,
      number: g.pedido.number,
      public_token: TOKEN,
      status: g.pedido.status,
      country_code: g.pedido.country_code,
      currency_code: g.pedido.currency_code,
      payment_method: g.pedido.payment_method,
      total_customer: g.pedido.total_customer,
      contact_first_name: String(g.fila.contact_first_name),
      contact_last_name: String(g.fila.contact_last_name),
      contact_email: (g.fila.contact_email as string | null) ?? null,
      contact_phone_e164: String(g.fila.contact_phone_e164),
      stock_reserved_until: new Date(AHORA.getTime() + 60 * 60_000),
    };
  };
  const fuente: FuentePagos = {
    pedidoPorId: async (id) => aPedido(id),
    pedidoPorToken: async (_p, t) => (t === TOKEN && mem.pedidos.size > 0 ? aPedido([...mem.pedidos.keys()][0]!) : null),
    intentosWompi: async (id) => intentos.filter((i) => i.order_id === id),
    credencialesWompi: async () => creds,
    insertarIntento: async (n) => {
      const i = { id: `p${intentos.length + 1}`, order_id: n.order_id, status: 'created' as const, purpose: 'full' as const, amount: n.amount, provider_reference: n.provider_reference, checkout_url: n.checkout_url, expires_at: n.expires_at, created_at: AHORA };
      intentos.push(i);
      return { ok: true, intento: i };
    },
    aplicarTransicion: async () => true,
  };
  const pagos: DepsPagos = { fuente: () => fuente, urlSitio: 'https://izaoperfumeria.com' };
  return { pagos, intentos };
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
  document: { type: 'CC', number: '123456' },
  shipping: { region_id: REGION, city_id: CIUDAD, district: null, address1: 'Calle 1 # 2-3', address2: null, notes: null },
  payment_method: 'wompi',
  discount_code: null,
  consents: { terms_and_data: true, whatsapp: false },
  data_policy_version: '2026-10',
};

describe('checkout con Wompi: intento de pago listo', () => {
  it('201 con payment {checkout_url https, expires_at} y fila payments creada', async () => {
    const mem = fuenteDePrueba();
    const { pagos, intentos } = pagosSobre(mem);
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    const res = await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador, ahora: () => AHORA, pagos });
    expect(res.status).toBe(201);
    const j = (await res.json()) as { next_step: string; payment: { checkout_url: string; expires_at: string } | null };
    expect(j.next_step).toBe('pay_wompi');
    expect(j.payment!.checkout_url.startsWith('https://checkout.wompi.co/p/?')).toBe(true);
    expect(j.payment!.expires_at).toBe(new Date(AHORA.getTime() + 3_600_000).toISOString());
    expect(intentos).toHaveLength(1);
    expect(JSON.stringify(j)).not.toContain('test_integrity_ficticio');
    expect(JSON.stringify(j)).not.toContain('"order_id"');
  });

  it('sin credenciales: el pedido se crea igual y payment = null', async () => {
    const mem = fuenteDePrueba();
    const { pagos } = pagosSobre(mem, null);
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    const res = await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador, ahora: () => AHORA, pagos });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { payment: unknown }).payment).toBeNull();
  });

  it('contra entrega no prepara pago de Wompi', async () => {
    const mem = fuenteDePrueba();
    const { pagos, intentos } = pagosSobre(mem);
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    await manejarCheckout(req('/api/checkout', { ...checkout, payment_method: 'cod', consents: { terms_and_data: true, whatsapp: true } }), {
      fuente: () => mem,
      limitador,
      ahora: () => AHORA,
      pagos,
    });
    expect(intentos).toHaveLength(0);
  });

  it('contra entrega encola cod.iniciar con el id del pedido y responde payment = null', async () => {
    const mem = fuenteDePrueba();
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    const encolados: string[] = [];
    const res = await manejarCheckout(req('/api/checkout', { ...checkout, payment_method: 'cod', consents: { terms_and_data: true, whatsapp: true } }), {
      fuente: () => mem,
      limitador,
      ahora: () => AHORA,
      encolarCod: async (id) => {
        encolados.push(id);
      },
    });
    expect(res.status).toBe(201);
    const j = (await res.json()) as { next_step: string; payment: unknown };
    expect(j.next_step).toBe('pay_cod_deposit');
    expect(j.payment).toBeNull();
    expect(encolados).toHaveLength(1);
    expect(encolados[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('contra entrega con Redis caído: el pedido se crea igual (201) y no lanza', async () => {
    const mem = fuenteDePrueba();
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    const res = await manejarCheckout(req('/api/checkout', { ...checkout, payment_method: 'cod', consents: { terms_and_data: true, whatsapp: true } }), {
      fuente: () => mem,
      limitador,
      ahora: () => AHORA,
      encolarCod: async () => {
        throw new Error('redis');
      },
    });
    expect(res.status).toBe(201);
  });

  it('pago con Wompi no encola cod.iniciar', async () => {
    const mem = fuenteDePrueba();
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    const encolados: string[] = [];
    await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador, ahora: () => AHORA, encolarCod: async (id) => void encolados.push(id) });
    expect(encolados).toEqual([]);
  });
});

describe('POST /api/checkout/pago', () => {
  async function conPedido() {
    const mem = fuenteDePrueba();
    const p = pagosSobre(mem);
    const limitador = crearLimitadorMemoria({ limite: 100, ventanaMs: 60_000 });
    await manejarCheckout(req('/api/checkout', checkout), { fuente: () => mem, limitador, ahora: () => AHORA });
    return { ...p, limitador };
  }

  it('200 con el intento; repetir lo reutiliza', async () => {
    const { pagos, limitador, intentos } = await conPedido();
    const d = { pagos, limitador, ahora: () => AHORA };
    const r1 = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN }), d);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { reused: boolean }).reused).toBe(false);
    const r2 = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN }), d);
    expect(((await r2.json()) as { reused: boolean }).reused).toBe(true);
    expect(intentos).toHaveLength(1);
  });

  it('token desconocido 404; entrada inválida 400; el monto de la petición se ignora', async () => {
    const { pagos, limitador, intentos } = await conPedido();
    const d = { pagos, limitador, ahora: () => AHORA };
    expect((await manejarPago(req('/api/checkout/pago', { country: 'co', token: 'f'.repeat(32) }), d)).status).toBe(404);
    expect((await manejarPago(req('/api/checkout/pago', { country: 'co', token: '../x' }), d)).status).toBe(400);
    const r = await manejarPago(req('/api/checkout/pago', { country: 'co', token: TOKEN, amount: '1' }), d);
    expect(r.status).toBe(200);
    expect(intentos[0]!.amount).toBe(200_000n);
  });
});
