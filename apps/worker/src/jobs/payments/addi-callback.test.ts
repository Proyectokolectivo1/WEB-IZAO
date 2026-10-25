import { describe, expect, it } from 'vitest';
import type { OrderStatusEvent } from '@izao/core/order-state';
import { verificarCallbackAddi, type CallbackAddi } from '@izao/addi';
import { CREDENCIALES_ADDI_PRUEBA, callbackAddi, type CallbackPrueba } from '@izao/addi/mock';
import type { FuenteFinanciacionWorker, PagoFila, PedidoFila, ResultadoWebhook } from './fuente.js';
import { procesarCallbackAddi } from './addi-callback.js';
import { ErrorReintentable } from './aprobacion.js';

const ORDER = '00000000-0000-4000-8000-000000000001';
const APP_ID = 'o957b4611-6ef7-4f1c-b9be-02207bd9fd80';
const REF = 'IZ-CO-000123-A1';

function pago(p: Partial<PagoFila> = {}): PagoFila {
  return {
    id: 'pago-1',
    order_id: ORDER,
    provider: 'addi',
    purpose: 'financing',
    amount: 220_000n,
    currency_code: 'COP',
    status: 'created',
    provider_reference: REF,
    provider_transaction_id: null,
    payment_link_id: null,
    created_at: '2026-10-20T15:00:00.000Z',
    ...p,
  };
}

/** Callback como lo deja el webhook ya autenticado (mismo camino que en producción). */
function callback(c: Partial<CallbackPrueba> = {}): CallbackAddi {
  const { cuerpo, headers } = callbackAddi({ orderId: REF, status: 'APPROVED', approvedAmount: '220000.0', ...c });
  const v = verificarCallbackAddi(new TextEncoder().encode(cuerpo), headers, {
    usuario: CREDENCIALES_ADDI_PRUEBA.usuarioCallback,
    clave: CREDENCIALES_ADDI_PRUEBA.claveCallback,
  });
  if (!v.ok) throw new Error('callback de prueba inválido');
  return v.callback;
}

function escenario(o: { pedido?: Partial<PedidoFila>; pagos?: PagoFila[]; stockOk?: boolean; comision?: boolean } = {}) {
  const pedido: PedidoFila = {
    id: ORDER,
    number: 'IZ-CO-000123',
    status: 'pendiente_pago',
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: 'addi',
    stock_state: 'reserved',
    ...o.pedido,
  };
  const pagos = o.pagos ?? [pago()];
  const registro = {
    eventos: [] as OrderStatusEvent[],
    paidAt: [] as (Date | undefined)[],
    alertas: [] as string[],
    webhooks: [] as ResultadoWebhook[],
    stockConfirmado: 0,
    canjeConfirmado: 0,
    transportadora: [] as string[],
    metodoComision: [] as string[],
    conflictoUnaVez: false,
  };
  const fuente: FuenteFinanciacionWorker = {
    pagosPorReferencia: async (ref) => pagos.filter((p) => p.provider_reference === ref),
    pagosDelPedido: async (id) => pagos.filter((p) => p.order_id === id),
    pedido: async (id) => (id === pedido.id ? { ...pedido } : null),
    actualizarPago: async (id, c) => {
      const p = pagos.find((x) => x.id === id)!;
      p.status = c.status;
      p.provider_transaction_id = c.provider_transaction_id;
      (p as PagoFila & { fee?: bigint | null; raw?: unknown }).fee = c.fee_amount;
      (p as PagoFila & { raw?: unknown }).raw = c.raw_last_event;
    },
    comision: async (_pais, metodo) => {
      registro.metodoComision.push(metodo);
      return o.comision === false ? null : { fee_pct: '6.00', fee_fixed: 0n, fee_tax_pct: '19' };
    },
    confirmarStock: async () => {
      if (o.stockOk === false) return { ok: false, estado: 'released', motivo: 'sin_stock', faltantes: [] };
      registro.stockConfirmado += 1;
      const repetido = pedido.stock_state === 'confirmed';
      pedido.stock_state = 'confirmed';
      return repetido ? { ok: true, estado: 'confirmed', repetido: true } : { ok: true, estado: 'confirmed' };
    },
    confirmarCanje: async () => {
      registro.canjeConfirmado += 1;
      return { ok: true, estado: 'sin_codigo' };
    },
    aplicarTransicion: async (id, ev, opciones) => {
      if (registro.conflictoUnaVez) {
        registro.conflictoUnaVez = false;
        return false;
      }
      if (id !== pedido.id || pedido.status !== ev.from_status) return false;
      pedido.status = ev.to_status;
      registro.eventos.push(ev);
      registro.paidAt.push(opciones?.paid_at);
      return true;
    },
    registrarAlerta: async (_id, motivo) => {
      registro.alertas.push(motivo);
    },
    marcarWebhook: async (_e, r) => {
      registro.webhooks.push(r);
    },
  };
  const AHORA = new Date('2026-10-20T15:20:00.000Z');
  const deps = {
    fuente,
    encolarTransportadora: async (orderId: string) => {
      registro.transportadora.push(orderId);
    },
    ahora: () => AHORA,
  };
  const correr = (c: Partial<CallbackPrueba> = {}) => {
    const cb = callback(c);
    return procesarCallbackAddi({ event_id: `${cb.applicationId}.${cb.status}.${cb.statusTimestamp}`, callback: cb }, deps);
  };
  return { pedido, pagos, registro, correr, AHORA };
}

describe('job addi.callback (§12.3): asocia por referencia, compara monto y transiciona', () => {
  it('APPROVED en pendiente_pago: pago aprobado con comisión de Addi, stock y canje, pagado con paid_at, transportadora', async () => {
    const s = escenario();
    const r = await s.correr();
    expect(r).toEqual({ accion: 'pagado', order_id: ORDER });
    // 6 % de 220 000 = 13 200; IVA 19 % = 2 508 → 15 708 (enteros, sin float).
    expect(s.pagos[0]).toMatchObject({ status: 'approved', provider_transaction_id: APP_ID, fee: 15_708n });
    expect(s.registro.metodoComision).toEqual(['addi']);
    expect(s.registro.stockConfirmado).toBe(1);
    expect(s.registro.canjeConfirmado).toBe(1);
    expect(s.pedido.status).toBe('pagado');
    expect(s.registro.eventos).toHaveLength(1);
    expect(s.registro.eventos[0]).toMatchObject({
      from_status: 'pendiente_pago',
      to_status: 'pagado',
      actor: 'webhook:addi',
      payload: { payment_id: 'pago-1', reference: REF, application_id: APP_ID },
    });
    expect(s.registro.paidAt).toEqual([s.AHORA]);
    expect(s.registro.transportadora).toEqual([ORDER]);
    expect(s.registro.webhooks).toEqual([{ ok: true }]);
  });

  it('callback duplicado: una sola transición y un solo evento de estado (caso 5 de §11.3)', async () => {
    const s = escenario();
    await s.correr();
    const r2 = await s.correr();
    expect(r2.accion).toBe('ya_pagado');
    expect(s.registro.eventos).toHaveLength(1);
    expect(s.registro.alertas).toEqual([]);
    expect(s.registro.webhooks).toEqual([{ ok: true }, { ok: true }]);
  });

  it('monto aprobado distinto al del pago (con recargo) → no aprueba, alerta y el pedido sigue pendiente', async () => {
    const s = escenario();
    const r = await s.correr({ approvedAmount: '200000.0' });
    expect(r.accion).toBe('monto_no_coincide');
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.pagos[0]!.status).toBe('created');
    expect(s.registro.alertas).toEqual(['monto_no_coincide']);
    expect(s.registro.transportadora).toEqual([]);
    expect(s.registro.webhooks).toEqual([{ ok: false, error: 'monto_no_coincide' }]);
  });

  it('moneda distinta o centavos → no aprueba', async () => {
    for (const c of [{ currency: 'USD' }, { approvedAmount: '220000.50' }]) {
      const s = escenario();
      expect((await s.correr(c)).accion).toBe('monto_no_coincide');
      expect(s.pedido.status).toBe('pendiente_pago');
    }
  });

  it('REJECTED, DECLINED, ABANDONED e INTERNAL_ERROR del último intento → pago_rechazado sin tocar stock', async () => {
    const esperado = { REJECTED: 'declined', DECLINED: 'declined', ABANDONED: 'expired', INTERNAL_ERROR: 'error' } as const;
    for (const [status, pagoStatus] of Object.entries(esperado)) {
      const s = escenario();
      const r = await s.correr({ status: status as keyof typeof esperado });
      expect(r.accion).toBe('pago_rechazado');
      expect(s.pagos[0]!.status).toBe(pagoStatus);
      expect(s.pedido.status).toBe('pago_rechazado');
      expect(s.registro.stockConfirmado).toBe(0);
      expect(s.registro.transportadora).toEqual([]);
      expect(s.registro.metodoComision).toEqual([]);
    }
  });

  it('rechazo de un intento viejo mientras hay uno más reciente → no toca el pedido', async () => {
    const s = escenario({
      pagos: [pago(), pago({ id: 'pago-2', provider_reference: 'IZ-CO-000123-A2', created_at: '2026-10-20T15:10:00.000Z' })],
    });
    const r = await s.correr({ status: 'REJECTED' });
    expect(r.accion).toBe('sin_cambio');
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.pagos[0]!.status).toBe('declined');
  });

  it('PENDING → pago pendiente, el pedido no cambia', async () => {
    const s = escenario();
    expect((await s.correr({ status: 'PENDING' })).accion).toBe('sin_cambio');
    expect(s.pagos[0]!.status).toBe('pending');
    expect(s.pedido.status).toBe('pendiente_pago');
  });

  it('PENDING tardío después de un rechazo → no reabre el pago', async () => {
    const s = escenario({ pedido: { status: 'pago_rechazado' }, pagos: [pago({ status: 'declined', provider_transaction_id: APP_ID })] });
    expect((await s.correr({ status: 'PENDING' })).accion).toBe('sin_cambio');
    expect(s.pagos[0]!.status).toBe('declined');
    expect(s.pedido.status).toBe('pago_rechazado');
  });

  it('rechazo después de un aprobado → no degrada, alerta y el pedido sigue pagado', async () => {
    const s = escenario({ pedido: { status: 'pagado' }, pagos: [pago({ status: 'approved', provider_transaction_id: APP_ID })] });
    const r = await s.correr({ status: 'REJECTED' });
    expect(r.accion).toBe('sin_cambio');
    expect(s.pagos[0]!.status).toBe('approved');
    expect(s.pedido.status).toBe('pagado');
    expect(s.registro.alertas).toEqual(['aprobado_luego_declined']);
  });

  it('APPROVED después de un rechazo del mismo intento → pendiente_pago → pagado', async () => {
    const s = escenario({ pedido: { status: 'pago_rechazado' }, pagos: [pago({ status: 'declined', provider_transaction_id: APP_ID })] });
    const r = await s.correr();
    expect(r.accion).toBe('pagado');
    expect(s.registro.eventos.map((e) => `${e.from_status}>${e.to_status}`)).toEqual([
      'pago_rechazado>pendiente_pago',
      'pendiente_pago>pagado',
    ]);
  });

  it('APPROVED sobre expirado → requiere_reembolso con alerta, sin confirmar stock ni despachar', async () => {
    const s = escenario({ pedido: { status: 'expirado' } });
    const r = await s.correr();
    expect(r.accion).toBe('requiere_reembolso');
    expect(s.pedido.status).toBe('requiere_reembolso');
    expect(s.registro.alertas).toEqual(['pago_tardio']);
    expect(s.registro.stockConfirmado).toBe(0);
    expect(s.registro.transportadora).toEqual([]);
  });

  it('APPROVED sobre cancelado → alerta para reembolsar, sin volver a reservar stock ni despachar (D-035)', async () => {
    const s = escenario({ pedido: { status: 'cancelado', stock_state: 'released' } });
    const r = await s.correr();
    expect(r.accion).toBe('pago_tras_cancelacion');
    expect(s.pedido.status).toBe('cancelado');
    expect(s.registro.alertas).toEqual(['pago_tras_cancelacion']);
    expect(s.registro.stockConfirmado).toBe(0);
    expect(s.registro.transportadora).toEqual([]);
  });

  it('otro pago de financiación ya aprobado → alerta de pago duplicado sin transición', async () => {
    const s = escenario({
      pedido: { status: 'pagado' },
      pagos: [
        pago({ status: 'approved', provider_transaction_id: 'otra-solicitud', provider_reference: 'IZ-CO-000123-A1' }),
        pago({ id: 'pago-2', provider_reference: 'IZ-CO-000123-A2', created_at: '2026-10-20T15:10:00.000Z' }),
      ],
    });
    const r = await s.correr({ orderId: 'IZ-CO-000123-A2' });
    expect(r.accion).toBe('pago_duplicado');
    expect(s.registro.alertas).toEqual(['pago_duplicado']);
    expect(s.registro.eventos).toEqual([]);
  });

  it('sin stock al confirmar → no pasa a pagado, alerta', async () => {
    const s = escenario({ stockOk: false });
    expect((await s.correr()).accion).toBe('sin_stock');
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.registro.alertas).toEqual(['sin_stock_al_aprobar']);
  });

  it('sin configuración de comisión → aprueba igual con fee_amount nulo', async () => {
    const s = escenario({ comision: false });
    expect((await s.correr()).accion).toBe('pagado');
    expect((s.pagos[0] as PagoFila & { fee?: bigint | null }).fee).toBeNull();
  });

  it('referencia sin pago en la base → error registrado, sin reintento', async () => {
    const s = escenario({ pagos: [] });
    const r = await s.correr();
    expect(r).toEqual({ accion: 'pago_no_encontrado', order_id: null });
    expect(s.registro.webhooks).toEqual([{ ok: false, error: 'pago_no_encontrado' }]);
  });

  it('pago que no es de financiación o pedido que no es de Addi → no transiciona', async () => {
    const a = escenario({ pagos: [pago({ purpose: 'full' })] });
    expect((await a.correr()).accion).toBe('proposito_no_soportado');
    expect(a.pedido.status).toBe('pendiente_pago');
    const b = escenario({ pedido: { payment_method: 'wompi' } });
    expect((await b.correr()).accion).toBe('estado_inesperado');
    expect(b.registro.alertas).toEqual(['proposito_no_coincide']);
    expect(b.pedido.status).toBe('pendiente_pago');
  });

  it('otra solicitud de Addi para la misma referencia → alerta y no aprueba', async () => {
    const s = escenario({ pagos: [pago({ provider_transaction_id: 'solicitud-anterior' })] });
    const r = await s.correr();
    expect(r.accion).toBe('solicitud_distinta');
    expect(s.registro.alertas).toEqual(['solicitud_distinta']);
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.pagos[0]!.status).toBe('created');
  });

  it('carrera: otro proceso cambió el pedido → lanza para reintentar', async () => {
    const s = escenario();
    s.registro.conflictoUnaVez = true;
    await expect(s.correr()).rejects.toBeInstanceOf(ErrorReintentable);
    expect(s.registro.transportadora).toEqual([]);
    // El reintento lo resuelve: el pago ya quedó aprobado y el pedido pasa a pagado.
    expect((await s.correr()).accion).toBe('pagado');
    expect(s.registro.eventos).toHaveLength(1);
  });
});
