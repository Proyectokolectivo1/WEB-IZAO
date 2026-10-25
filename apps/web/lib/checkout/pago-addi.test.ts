import { describe, expect, it } from 'vitest';
import type { OrderStatusEvent } from '@izao/core/order-state';
import { crearClienteAddi, type AddiCredentials } from '@izao/addi';
import { CREDENCIALES_ADDI_PRUEBA, fetchAddiFalso, type RespuestaSolicitudFalsa } from '@izao/addi/mock';
import { prepararPagoAddi, type FuentePagosAddi, type IntentoAddi, type PedidoAddiParaPago } from './pago-addi';

const AHORA = new Date('2026-10-20T15:00:00.000Z');
const VENCE = new Date('2026-10-20T16:00:00.000Z');

function memoria(
  o: {
    pedido?: Partial<PedidoAddiParaPago>;
    intentos?: Partial<IntentoAddi>[];
    creds?: AddiCredentials | null;
    solicitud?: RespuestaSolicitudFalsa;
    duplicarUnaVez?: boolean;
  } = {},
) {
  const pedido: PedidoAddiParaPago = {
    id: 'o1',
    number: 'IZ-CO-000123',
    public_token: 'tok_publico_123',
    status: 'pendiente_pago',
    payment_method: 'addi',
    country_code: 'CO',
    currency_code: 'COP',
    subtotal: 200_000n,
    discount_amount: 0n,
    financing_surcharge_amount: 20_000n,
    total_customer: 220_000n,
    contact_first_name: 'Ana',
    contact_last_name: 'Pérez',
    contact_email: 'ana@example.com',
    contact_phone_e164: '+573001234567',
    document_type: 'CC',
    document_number: '1020304050',
    shipping_address1: 'Calle 10 # 43-12',
    shipping_address2: 'Apto 301',
    shipping_city_name: 'Medellín',
    stock_reserved_until: VENCE,
    items: [{ sku: 'IZ-001-100', name: 'Fragancia Ámbar', variant_label: '100 ml', quantity: 2, unit_price: 100_000n, line_discount: 0n }],
    ...o.pedido,
  };
  const intentos: IntentoAddi[] = (o.intentos ?? []).map((i, n) => ({
    id: `p${n + 1}`,
    status: 'declined',
    amount: 220_000n,
    provider_reference: `IZ-CO-000123-A${n + 1}`,
    checkout_url: 'https://checkout.addi-staging.com/aplicacion/x',
    expires_at: VENCE,
    created_at: new Date(AHORA.getTime() - 60_000 * (10 - n)),
    ...i,
  }));
  const eventos: OrderStatusEvent[] = [];
  const red = fetchAddiFalso({ solicitud: o.solicitud ?? 'redirige' });
  let duplicar = o.duplicarUnaVez ?? false;
  const fuente: FuentePagosAddi = {
    pedidoAddiPorId: async (id) => (id === pedido.id ? pedido : null),
    intentosAddi: async () => intentos.map((i) => ({ ...i })),
    credencialesAddi: async () => (o.creds === undefined ? CREDENCIALES_ADDI_PRUEBA : o.creds),
    insertarIntentoAddi: async (n) => {
      if (duplicar) {
        duplicar = false;
        return { ok: false, motivo: 'duplicado' };
      }
      const nuevo: IntentoAddi = {
        id: `p${intentos.length + 1}`,
        status: 'created',
        amount: n.amount,
        provider_reference: n.provider_reference,
        checkout_url: null,
        expires_at: n.expires_at,
        created_at: AHORA,
      };
      intentos.push(nuevo);
      return { ok: true, intento: { ...nuevo } };
    },
    completarIntentoAddi: async (id, c) => {
      const i = intentos.find((x) => x.id === id)!;
      i.status = c.status;
      i.checkout_url = c.checkout_url;
      (i as IntentoAddi & { error?: string | null }).error = c.error;
    },
    aplicarTransicion: async (_id, ev) => {
      if (pedido.status !== ev.from_status) return false;
      pedido.status = ev.to_status;
      eventos.push(ev);
      return true;
    },
  };
  const opc = {
    ahora: AHORA,
    urlSitio: 'https://izaoperfumeria.com',
    cliente: (c: AddiCredentials) => crearClienteAddi({ credenciales: c, fetchImpl: red.fetch }),
  };
  return { fuente, pedido, intentos, eventos, red, opc };
}

const solicitudes = (m: ReturnType<typeof memoria>) =>
  m.red.llamadas.filter((l) => l.url.endsWith('/v1/online-applications'));

describe('prepararPagoAddi (next_step = pay_addi, §12.3)', () => {
  it('primer intento: registra el pago antes de llamar a Addi, envía total con recargo y devuelve la URL de Addi', async () => {
    const m = memoria();
    const r = await prepararPagoAddi(m.fuente, m.pedido, m.opc);
    expect(r).toEqual({
      ok: true,
      reutilizado: false,
      pago: {
        checkout_url: 'https://checkout.addi-staging.com/aplicacion/IZ-CO-000123-A1',
        expires_at: VENCE,
        reference: 'IZ-CO-000123-A1',
      },
    });
    const [s] = solicitudes(m);
    const cuerpo = s!.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      orderId: 'IZ-CO-000123-A1',
      totalAmount: '220000.0',
      currency: 'COP',
      allyUrlRedirection: {
        callbackUrl: 'https://izaoperfumeria.com/api/webhooks/addi',
        redirectionUrl: 'https://izaoperfumeria.com/co/pedido/tok_publico_123',
      },
    });
    expect((cuerpo.items as { sku: string; unitPrice: string }[]).at(-1)).toEqual({
      sku: 'CARGO-FINANCIACION',
      name: 'Cargo por financiación',
      quantity: '1',
      unitPrice: '20000.0',
    });
    expect(s!.redirect).toBe('manual');
    expect(m.intentos).toHaveLength(1);
    expect(m.intentos[0]).toMatchObject({
      status: 'created',
      amount: 220_000n,
      provider_reference: 'IZ-CO-000123-A1',
      checkout_url: 'https://checkout.addi-staging.com/aplicacion/IZ-CO-000123-A1',
      expires_at: VENCE,
    });
  });

  it('idempotente: con una solicitud vigente la reutiliza sin crear otra en Addi', async () => {
    const m = memoria();
    await prepararPagoAddi(m.fuente, m.pedido, m.opc);
    const r2 = await prepararPagoAddi(m.fuente, m.pedido, m.opc);
    expect(r2.ok && r2.reutilizado).toBe(true);
    expect(solicitudes(m)).toHaveLength(1);
    expect(m.intentos).toHaveLength(1);
  });

  it('solicitud en curso (registrada hace segundos, sin URL todavía) → conflicto, no crea otra', async () => {
    const m = memoria({ intentos: [{ status: 'created', checkout_url: null, created_at: new Date(AHORA.getTime() - 5_000) }] });
    expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'conflicto' });
    expect(solicitudes(m)).toHaveLength(0);
  });

  it('intento colgado (sin URL hace más de 1 min) → se marca error y se crea A2', async () => {
    const m = memoria({ intentos: [{ status: 'created', checkout_url: null, created_at: new Date(AHORA.getTime() - 120_000) }] });
    const r = await prepararPagoAddi(m.fuente, m.pedido, m.opc);
    expect(r.ok && r.pago.reference).toBe('IZ-CO-000123-A2');
    expect(m.intentos[0]!.status).toBe('error');
  });

  it('reintento tras pago_rechazado: vuelve a pendiente_pago y crea A2 (Addi exige orderId único)', async () => {
    const m = memoria({ pedido: { status: 'pago_rechazado' }, intentos: [{ status: 'declined' }] });
    const r = await prepararPagoAddi(m.fuente, m.pedido, m.opc);
    expect(r.ok && r.pago.reference).toBe('IZ-CO-000123-A2');
    expect(m.eventos.map((e) => `${e.from_status}>${e.to_status}`)).toEqual(['pago_rechazado>pendiente_pago']);
  });

  it('el cliente ya tiene crédito en Addi (409) → intento declined y pedido a pago_rechazado (elige otro método)', async () => {
    const m = memoria({ solicitud: 'conflicto' });
    expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'rechazado_entidad' });
    expect(m.intentos[0]).toMatchObject({ status: 'declined', checkout_url: null, error: 'CLIENTE_CON_CREDITO' });
    expect(m.pedido.status).toBe('pago_rechazado');
  });

  it('Addi rechaza los datos (400) → intento error y pedido a pago_rechazado', async () => {
    const m = memoria({ solicitud: 'validacion' });
    expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'rechazado_entidad' });
    expect(m.intentos[0]).toMatchObject({ status: 'error', error: 'VALIDACION' });
    expect(m.pedido.status).toBe('pago_rechazado');
  });

  it('Addi caído, sin red o Location insegura → intento error, el pedido sigue pendiente y se puede reintentar', async () => {
    for (const solicitud of ['caida', 'red', 'location_http', 'sin_location'] as const) {
      const m = memoria({ solicitud });
      expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'entidad_no_disponible' });
      expect(m.intentos[0]!.status).toBe('error');
      expect(m.pedido.status).toBe('pendiente_pago');
    }
  });

  it('credenciales rechazadas por Addi → sin_credenciales, el pedido sigue pendiente', async () => {
    const m = memoria({ creds: { ...CREDENCIALES_ADDI_PRUEBA, clientSecret: 'otro-secreto' } });
    expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'sin_credenciales' });
    expect(m.intentos[0]!.status).toBe('error');
    expect(m.pedido.status).toBe('pendiente_pago');
  });

  it('sin credenciales activas → sin_credenciales sin registrar intento', async () => {
    const m = memoria({ creds: null });
    expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'sin_credenciales' });
    expect(m.intentos).toEqual([]);
  });

  it('datos que Addi no admite (otro documento, sin correo) → datos_cliente sin llamar a Addi', async () => {
    for (const p of [{ document_type: 'CE' }, { contact_email: null }]) {
      const m = memoria({ pedido: p });
      expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toMatchObject({ ok: false, motivo: 'datos_cliente' });
      expect(m.intentos).toEqual([]);
      expect(solicitudes(m)).toHaveLength(0);
    }
  });

  it('pedido con descuento o totales que no cuadran → nunca se envía a Addi', async () => {
    for (const p of [{ discount_amount: 10_000n }, { total_customer: 219_999n }]) {
      const m = memoria({ pedido: p });
      expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toMatchObject({ ok: false, motivo: 'datos_cliente' });
      expect(solicitudes(m)).toHaveLength(0);
    }
  });

  it('otro método, pagado, vencido o en otro estado → no prepara', async () => {
    expect((await prepararPagoAddi(memoria().fuente, memoria({ pedido: { payment_method: 'wompi' } }).pedido, memoria().opc)))
      .toEqual({ ok: false, motivo: 'metodo' });
    const pagado = memoria({ pedido: { status: 'pagado' } });
    expect(await prepararPagoAddi(pagado.fuente, pagado.pedido, pagado.opc)).toEqual({ ok: false, motivo: 'pagado' });
    const aprobado = memoria({ intentos: [{ status: 'approved' }] });
    expect(await prepararPagoAddi(aprobado.fuente, aprobado.pedido, aprobado.opc)).toEqual({ ok: false, motivo: 'pagado' });
    const vencido = memoria({ pedido: { stock_reserved_until: new Date(AHORA.getTime() + 60_000) } });
    expect(await prepararPagoAddi(vencido.fuente, vencido.pedido, vencido.opc)).toEqual({ ok: false, motivo: 'vencido' });
    const expirado = memoria({ pedido: { status: 'expirado' } });
    expect(await prepararPagoAddi(expirado.fuente, expirado.pedido, expirado.opc)).toEqual({ ok: false, motivo: 'estado' });
  });

  it('carrera al registrar el intento (referencia duplicada) → conflicto sin llamar a Addi', async () => {
    const m = memoria({ duplicarUnaVez: true });
    expect(await prepararPagoAddi(m.fuente, m.pedido, m.opc)).toEqual({ ok: false, motivo: 'conflicto' });
    expect(solicitudes(m)).toHaveLength(0);
  });

  it('SITE_URL sin https → lanza (configuración)', async () => {
    const m = memoria();
    await expect(prepararPagoAddi(m.fuente, m.pedido, { ...m.opc, urlSitio: 'http://izao.test' })).rejects.toThrow(RangeError);
  });
});
