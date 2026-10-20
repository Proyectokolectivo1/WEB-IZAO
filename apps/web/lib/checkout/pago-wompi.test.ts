import { describe, expect, it } from 'vitest';
import type { OrderStatusEvent } from '@izao/core/order-state';
import type { WompiCredentials } from '@izao/wompi';
import { firmaIntegridad } from '@izao/wompi';
import { prepararPagoWompi, type FuentePagos, type IntentoPago, type PedidoParaPago } from './pago-wompi';

const AHORA = new Date('2026-10-20T15:00:00.000Z');
const VENCE = new Date('2026-10-20T16:00:00.000Z');
const CREDS: WompiCredentials = {
  ambiente: 'sandbox',
  llavePublica: 'pub_test_ficticia',
  llavePrivada: 'prv_test_ficticia',
  secretoEventos: 'test_events_ficticio',
  secretoIntegridad: 'test_integrity_ficticio',
};

function memoria(o: { pedido?: Partial<PedidoParaPago>; intentos?: Partial<IntentoPago>[]; creds?: WompiCredentials | null; duplicarUnaVez?: boolean } = {}) {
  const pedido: PedidoParaPago = {
    id: 'o1',
    number: 'IZ-CO-000123',
    public_token: 'tok_publico_123',
    status: 'pendiente_pago',
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: 'wompi',
    total_customer: 249_900n,
    contact_first_name: 'Ana',
    contact_last_name: 'Pérez',
    contact_email: 'ana@example.com',
    contact_phone_e164: '+573001234567',
    stock_reserved_until: VENCE,
    ...o.pedido,
  };
  const intentos: IntentoPago[] = (o.intentos ?? []).map((i, n) => ({
    id: `p${n + 1}`,
    status: 'declined',
    purpose: 'full',
    amount: 249_900n,
    provider_reference: `IZ-CO-000123-P${n + 1}`,
    checkout_url: 'https://checkout.wompi.co/p/?x',
    expires_at: VENCE,
    created_at: new Date(AHORA.getTime() - 60_000 * (10 - n)),
    ...i,
  }));
  const eventos: OrderStatusEvent[] = [];
  let duplicar = o.duplicarUnaVez ?? false;
  const fuente: FuentePagos = {
    pedidoPorId: async () => pedido,
    pedidoPorToken: async () => pedido,
    intentosWompi: async () => intentos.map((i) => ({ ...i })),
    credencialesWompi: async () => (o.creds === undefined ? CREDS : o.creds),
    insertarIntento: async (n) => {
      if (duplicar) {
        duplicar = false;
        intentos.push({ id: 'otro', status: 'created', purpose: 'full', amount: n.amount, provider_reference: n.provider_reference, checkout_url: 'https://checkout.wompi.co/p/?otro', expires_at: n.expires_at, created_at: AHORA });
        return { ok: false, motivo: 'duplicado' };
      }
      const nuevo: IntentoPago = { id: `p${intentos.length + 1}`, status: 'created', purpose: 'full', amount: n.amount, provider_reference: n.provider_reference, checkout_url: n.checkout_url, expires_at: n.expires_at, created_at: AHORA };
      intentos.push(nuevo);
      return { ok: true, intento: nuevo };
    },
    aplicarTransicion: async (_id, ev) => {
      if (pedido.status !== ev.from_status) return false;
      pedido.status = ev.to_status;
      eventos.push(ev);
      return true;
    },
  };
  return { fuente, pedido, intentos, eventos };
}

const OPC = { ahora: AHORA, urlSitio: 'https://izaoperfumeria.com' };

describe('prepararPagoWompi (next_step = pay_wompi, §12.2)', () => {
  it('primer intento: fila created con URL https firmada, vence con la reserva del pedido', async () => {
    const m = memoria();
    const r = await prepararPagoWompi(m.fuente, m.pedido, OPC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reutilizado).toBe(false);
    expect(r.pago.reference).toBe('IZ-CO-000123-P1');
    expect(r.pago.expires_at.toISOString()).toBe(VENCE.toISOString());
    expect(r.pago.checkout_url.startsWith('https://checkout.wompi.co/p/?')).toBe(true);
    const q = new URL(r.pago.checkout_url).searchParams;
    expect(q.get('amount-in-cents')).toBe('24990000');
    expect(q.get('redirect-url')).toBe('https://izaoperfumeria.com/co/pedido/tok_publico_123');
    expect(q.get('expiration-time')).toBe(VENCE.toISOString());
    expect(q.get('signature:integrity')).toBe(
      firmaIntegridad({ referencia: 'IZ-CO-000123-P1', montoEnCentavos: 24_990_000n, moneda: 'COP', expiracion: VENCE.toISOString(), secretoIntegridad: CREDS.secretoIntegridad }),
    );
    expect(r.pago.checkout_url).not.toContain(CREDS.secretoIntegridad);
    expect(m.intentos).toHaveLength(1);
    expect(m.intentos[0]).toMatchObject({ status: 'created', amount: 249_900n, provider_reference: 'IZ-CO-000123-P1' });
  });

  it('idempotente: con un intento vigente lo reutiliza sin crear otro', async () => {
    const m = memoria();
    await prepararPagoWompi(m.fuente, m.pedido, OPC);
    const r2 = await prepararPagoWompi(m.fuente, m.pedido, OPC);
    expect(r2.ok && r2.reutilizado).toBe(true);
    expect(m.intentos).toHaveLength(1);
  });

  it('un intento pendiente (pago en curso) también se reutiliza: misma referencia, Wompi no cobra dos veces', async () => {
    const m = memoria({ intentos: [{ status: 'pending' }] });
    const r = await prepararPagoWompi(m.fuente, m.pedido, OPC);
    expect(r.ok && r.reutilizado && r.pago.reference).toBe('IZ-CO-000123-P1');
  });

  it('reintento tras rechazo: pago_rechazado → pendiente_pago con transicionar y referencia P2', async () => {
    const m = memoria({ pedido: { status: 'pago_rechazado' }, intentos: [{ status: 'declined' }] });
    const r = await prepararPagoWompi(m.fuente, m.pedido, OPC);
    expect(r.ok && r.pago.reference).toBe('IZ-CO-000123-P2');
    expect(m.eventos).toHaveLength(1);
    expect(m.eventos[0]).toMatchObject({ from_status: 'pago_rechazado', to_status: 'pendiente_pago', actor: 'system' });
  });

  it('pedido ya pagado o con un intento aprobado → no crea cobro', async () => {
    expect(await prepararPagoWompi(memoria({ pedido: { status: 'pagado' } }).fuente, memoria({ pedido: { status: 'pagado' } }).pedido, OPC)).toEqual({ ok: false, motivo: 'pagado' });
    const m = memoria({ intentos: [{ status: 'approved' }] });
    expect(await prepararPagoWompi(m.fuente, m.pedido, OPC)).toEqual({ ok: false, motivo: 'pagado' });
    expect(m.intentos).toHaveLength(1);
  });

  it('otro método, otra moneda o estado no cobrable → rechazado', async () => {
    const a = memoria({ pedido: { payment_method: 'cod' } });
    expect(await prepararPagoWompi(a.fuente, a.pedido, OPC)).toEqual({ ok: false, motivo: 'metodo' });
    const b = memoria({ pedido: { currency_code: 'USD', country_code: 'EC' } });
    expect(await prepararPagoWompi(b.fuente, b.pedido, OPC)).toEqual({ ok: false, motivo: 'metodo' });
    const c = memoria({ pedido: { status: 'expirado' } });
    expect(await prepararPagoWompi(c.fuente, c.pedido, OPC)).toEqual({ ok: false, motivo: 'estado' });
  });

  it('reserva vencida o por vencer en menos del margen → vencido', async () => {
    const a = memoria({ pedido: { stock_reserved_until: new Date(AHORA.getTime() + 60_000) } });
    expect(await prepararPagoWompi(a.fuente, a.pedido, OPC)).toEqual({ ok: false, motivo: 'vencido' });
    const b = memoria({ pedido: { stock_reserved_until: null } });
    expect(await prepararPagoWompi(b.fuente, b.pedido, OPC)).toEqual({ ok: false, motivo: 'vencido' });
  });

  it('sin credenciales activas → sin_credenciales y nada escrito', async () => {
    const m = memoria({ creds: null });
    expect(await prepararPagoWompi(m.fuente, m.pedido, OPC)).toEqual({ ok: false, motivo: 'sin_credenciales' });
    expect(m.intentos).toHaveLength(0);
  });

  it('carrera al insertar la misma referencia → devuelve el intento que ganó', async () => {
    const m = memoria({ duplicarUnaVez: true });
    const r = await prepararPagoWompi(m.fuente, m.pedido, OPC);
    expect(r.ok && r.reutilizado && r.pago.checkout_url).toBe('https://checkout.wompi.co/p/?otro');
  });

  it('URL del sitio que no es https → error', async () => {
    const m = memoria();
    await expect(prepararPagoWompi(m.fuente, m.pedido, { ...OPC, urlSitio: 'http://izao.test' })).rejects.toThrow();
  });
});
