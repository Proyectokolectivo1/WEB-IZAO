import { describe, expect, it } from 'vitest';
import type { OrderStatusEvent } from '@izao/core/order-state';
import { crearClienteWompi, type WompiCredentials } from '@izao/wompi';
import { LLAVE_PRIVADA_PRUEBA, fetchWompiFalso, type TransaccionPrueba } from '@izao/wompi/mock';
import type { FuentePagosWorker, PagoFila, PedidoFila, ResultadoWebhook } from './fuente.js';
import { ErrorReintentable, procesarTransaccionWompi } from './wompi-transaccion.js';

const CREDS: WompiCredentials = {
  ambiente: 'sandbox',
  llavePublica: 'pub_test_ficticia',
  llavePrivada: LLAVE_PRIVADA_PRUEBA,
  secretoEventos: 'test_events_ficticio',
  secretoIntegridad: 'test_integrity_ficticio',
};
const ORDER = '00000000-0000-4000-8000-000000000001';
const TX_ID = '1234-1610641025-49201';

function pago(p: Partial<PagoFila> = {}): PagoFila {
  return {
    id: 'pago-1',
    order_id: ORDER,
    provider: 'wompi',
    purpose: 'full',
    amount: 249_900n,
    currency_code: 'COP',
    status: 'created',
    provider_reference: 'IZ-CO-000123-P1',
    provider_transaction_id: null,
    payment_link_id: null,
    created_at: '2026-10-20T15:00:00.000Z',
    ...p,
  };
}

function escenario(o: { pedido?: Partial<PedidoFila>; pagos?: PagoFila[]; tx?: Partial<TransaccionPrueba>; stockOk?: boolean } = {}) {
  const pedido: PedidoFila = {
    id: ORDER,
    number: 'IZ-CO-000123',
    status: 'pendiente_pago',
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: 'wompi',
    stock_state: 'reserved',
    ...o.pedido,
  };
  const pagos = o.pagos ?? [pago()];
  const tx: TransaccionPrueba = {
    id: TX_ID,
    status: 'APPROVED',
    amount_in_cents: 24_990_000,
    reference: 'IZ-CO-000123-P1',
    ...o.tx,
  };
  const red = fetchWompiFalso([tx]);
  const registro = {
    eventos: [] as OrderStatusEvent[],
    alertas: [] as string[],
    webhooks: [] as ResultadoWebhook[],
    stockConfirmado: 0,
    canjeConfirmado: 0,
    transportadora: [] as string[],
    codCancelado: [] as string[],
    conflictoUnaVez: false,
  };
  const fuente: FuentePagosWorker = {
    credencialesWompi: async () => CREDS,
    pagosPorReferencia: async (ref) => pagos.filter((p) => p.provider_reference === ref),
    pagosPorLink: async (id) => pagos.filter((p) => p.payment_link_id === id),
    pagosDelPedido: async (id) => pagos.filter((p) => p.order_id === id),
    pedido: async (id) => (id === pedido.id ? { ...pedido } : null),
    actualizarPago: async (id, c) => {
      const p = pagos.find((x) => x.id === id)!;
      p.status = c.status;
      p.provider_transaction_id = c.provider_transaction_id;
      (p as PagoFila & { fee?: bigint | null }).fee = c.fee_amount;
    },
    comision: async () => ({ fee_pct: '2.65', fee_fixed: 700n, fee_tax_pct: '19' }),
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
    aplicarTransicion: async (id, ev) => {
      if (registro.conflictoUnaVez) {
        registro.conflictoUnaVez = false;
        return false;
      }
      if (id !== pedido.id || pedido.status !== ev.from_status) return false;
      pedido.status = ev.to_status;
      registro.eventos.push(ev);
      return true;
    },
    registrarAlerta: async (_id, motivo) => {
      registro.alertas.push(motivo);
    },
    marcarWebhook: async (_e, r) => {
      registro.webhooks.push(r);
    },
  };
  const deps = {
    fuente,
    cliente: (c: WompiCredentials) => crearClienteWompi({ ambiente: c.ambiente, llavePrivada: c.llavePrivada, fetchImpl: red.fetch }),
    encolarTransportadora: async (orderId: string) => {
      registro.transportadora.push(orderId);
    },
    cancelarJobsCod: async (orderId: string) => {
      registro.codCancelado.push(orderId);
    },
  };
  const correr = () => procesarTransaccionWompi({ event_id: `${TX_ID}.${tx.status}`, transaction_id: TX_ID }, deps);
  return { pedido, pagos, red, registro, correr };
}

describe('job wompi.transaccion (§12.2): reconsulta, asocia y transiciona', () => {
  it('APPROVED en pendiente_pago: pago aprobado con comisión, stock y canje confirmados, pagado, transportadora encolada', async () => {
    const s = escenario();
    const r = await s.correr();
    expect(r.accion).toBe('pagado');
    expect(s.red.llamadas).toHaveLength(1); // siempre reconsulta la API
    expect(s.pagos[0]).toMatchObject({ status: 'approved', provider_transaction_id: TX_ID, fee: 8_714n });
    expect(s.registro.stockConfirmado).toBe(1);
    expect(s.registro.canjeConfirmado).toBe(1);
    expect(s.pedido.status).toBe('pagado');
    expect(s.registro.eventos).toHaveLength(1);
    expect(s.registro.eventos[0]).toMatchObject({
      from_status: 'pendiente_pago',
      to_status: 'pagado',
      actor: 'webhook:wompi',
      payload: { payment_id: 'pago-1', reference: 'IZ-CO-000123-P1', transaction_id: TX_ID },
    });
    expect(s.registro.transportadora).toEqual([ORDER]);
    expect(s.registro.webhooks).toEqual([{ ok: true }]);
  });

  it('doble entrega del mismo evento: una sola transición y un solo evento de estado', async () => {
    const s = escenario();
    await s.correr();
    const r2 = await s.correr();
    expect(r2.accion).toBe('ya_pagado');
    expect(s.registro.eventos).toHaveLength(1);
    expect(s.pedido.status).toBe('pagado');
    expect(s.registro.alertas).toEqual([]);
    // Los pasos posteriores se repiten de forma idempotente (stock `repetido`, job con id fijo).
    expect(s.registro.webhooks).toEqual([{ ok: true }, { ok: true }]);
  });

  it('monto distinto al del pago → no aprueba, alerta y el pedido sigue pendiente', async () => {
    const s = escenario({ tx: { amount_in_cents: 100_000 } });
    const r = await s.correr();
    expect(r.accion).toBe('monto_no_coincide');
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.pagos[0]!.status).toBe('created');
    expect(s.registro.alertas).toEqual(['monto_no_coincide']);
    expect(s.registro.transportadora).toEqual([]);
    expect(s.registro.webhooks).toEqual([{ ok: false, error: 'monto_no_coincide' }]);
  });

  it('moneda distinta → no aprueba', async () => {
    const s = escenario({ tx: { currency: 'USD' } });
    expect((await s.correr()).accion).toBe('monto_no_coincide');
    expect(s.pedido.status).toBe('pendiente_pago');
  });

  it('DECLINED del último intento → pago_rechazado', async () => {
    const s = escenario({ tx: { status: 'DECLINED' } });
    const r = await s.correr();
    expect(r.accion).toBe('pago_rechazado');
    expect(s.pagos[0]!.status).toBe('declined');
    expect(s.pedido.status).toBe('pago_rechazado');
    expect(s.registro.stockConfirmado).toBe(0);
  });

  it('ERROR y VOIDED también rechazan el pago completo', async () => {
    for (const status of ['ERROR', 'VOIDED'] as const) {
      const s = escenario({ tx: { status } });
      expect((await s.correr()).accion).toBe('pago_rechazado');
    }
  });

  it('DECLINED de un intento viejo mientras hay uno más reciente → no toca el pedido', async () => {
    const s = escenario({
      tx: { status: 'DECLINED' },
      pagos: [pago(), pago({ id: 'pago-2', provider_reference: 'IZ-CO-000123-P2', created_at: '2026-10-20T15:10:00.000Z' })],
    });
    const r = await s.correr();
    expect(r.accion).toBe('sin_cambio');
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.pagos[0]!.status).toBe('declined');
  });

  it('PENDING → pago pendiente, el pedido no cambia', async () => {
    const s = escenario({ tx: { status: 'PENDING' } });
    expect((await s.correr()).accion).toBe('sin_cambio');
    expect(s.pagos[0]!.status).toBe('pending');
    expect(s.pedido.status).toBe('pendiente_pago');
  });

  it('APPROVED sobre expirado → requiere_reembolso con alerta, sin confirmar stock ni despachar', async () => {
    const s = escenario({ pedido: { status: 'expirado', stock_state: 'released' } });
    const r = await s.correr();
    expect(r.accion).toBe('requiere_reembolso');
    expect(s.pedido.status).toBe('requiere_reembolso');
    expect(s.registro.stockConfirmado).toBe(0);
    expect(s.registro.transportadora).toEqual([]);
    expect(s.registro.alertas).toEqual(['pago_tardio']);
  });

  it('APPROVED sobre pago_rechazado (reintento) → pendiente_pago → pagado, dos eventos', async () => {
    const s = escenario({ pedido: { status: 'pago_rechazado' } });
    const r = await s.correr();
    expect(r.accion).toBe('pagado');
    expect(s.registro.eventos.map((e) => `${e.from_status}>${e.to_status}`)).toEqual([
      'pago_rechazado>pendiente_pago',
      'pendiente_pago>pagado',
    ]);
  });

  it('segundo pago aprobado para un pedido ya pagado por otro intento → alerta de pago duplicado', async () => {
    const s = escenario({
      pedido: { status: 'pagado', stock_state: 'confirmed' },
      pagos: [
        pago({ id: 'pago-0', provider_reference: 'IZ-CO-000123-P0', status: 'approved', provider_transaction_id: 'otra' }),
        pago(),
      ],
    });
    const r = await s.correr();
    expect(r.accion).toBe('pago_duplicado');
    expect(s.registro.alertas).toEqual(['pago_duplicado']);
    expect(s.registro.transportadora).toEqual([]);
    expect(s.registro.eventos).toEqual([]);
  });

  it('sin stock al confirmar → no pasa a pagado, alerta', async () => {
    const s = escenario({ stockOk: false });
    const r = await s.correr();
    expect(r.accion).toBe('sin_stock');
    expect(s.pedido.status).toBe('pendiente_pago');
    expect(s.registro.alertas).toEqual(['sin_stock_al_aprobar']);
    expect(s.registro.transportadora).toEqual([]);
  });

  it('referencia sin pago en la base → error registrado, sin reintento', async () => {
    const s = escenario({ tx: { reference: 'OTRA-REF' } });
    const r = await s.correr();
    expect(r.accion).toBe('pago_no_encontrado');
    expect(s.registro.webhooks).toEqual([{ ok: false, error: 'pago_no_encontrado' }]);
  });

  it('financiación aún no soportada por este job → queda sin procesar', async () => {
    const s = escenario({ pagos: [pago({ purpose: 'financing' })] });
    const r = await s.correr();
    expect(r.accion).toBe('proposito_no_soportado');
    expect(s.pedido.status).toBe('pendiente_pago');
  });

  it('caída de la API de Wompi o sin credenciales → lanza para que BullMQ reintente', async () => {
    const s = escenario();
    s.red.fallarCon = 503;
    await expect(s.correr()).rejects.toBeInstanceOf(ErrorReintentable);
    expect(s.registro.webhooks).toEqual([]);

    const r = procesarTransaccionWompi(
      { event_id: 'x', transaction_id: TX_ID },
      {
        fuente: sinCredFuente(),
        cliente: () => crearClienteWompi({ ambiente: 'sandbox', llavePrivada: 'x', fetchImpl: s.red.fetch }),
        encolarTransportadora: async () => {},
        cancelarJobsCod: async () => {},
      },
    );
    await expect(r).rejects.toBeInstanceOf(ErrorReintentable);
  });

  it('carrera: otro proceso cambió el pedido → lanza para reintentar y la nueva lectura decide', async () => {
    const s = escenario();
    s.registro.conflictoUnaVez = true;
    await expect(s.correr()).rejects.toBeInstanceOf(ErrorReintentable);
    expect((await s.correr()).accion).toBe('pagado');
    expect(s.registro.eventos).toHaveLength(1);
  });

  it('transacción inexistente en Wompi → error registrado, sin reintento', async () => {
    const s = escenario();
    s.red.transacciones.clear();
    expect((await s.correr()).accion).toBe('transaccion_inexistente');
  });
});

function sinCredFuente(): FuentePagosWorker {
  const no = async () => {
    throw new Error('no debe llamarse');
  };
  return {
    credencialesWompi: async () => null,
    pagosPorReferencia: no,
    pagosPorLink: no,
    pagosDelPedido: no,
    pedido: no,
    actualizarPago: no,
    comision: no,
    confirmarStock: no,
    confirmarCanje: no,
    aplicarTransicion: no,
    registrarAlerta: no,
    marcarWebhook: no,
  };
}

const LINK = 'test_LINK1';

function abono(o: { pedido?: Partial<PedidoFila>; pagos?: PagoFila[]; tx?: Partial<TransaccionPrueba>; stockOk?: boolean } = {}) {
  return escenario({
    pedido: { status: 'esperando_abono', payment_method: 'cod', ...o.pedido },
    pagos: o.pagos ?? [
      pago({ id: 'abono-1', purpose: 'cod_deposit', amount: 30_000n, provider_reference: 'IZ-CO-000123-A1', payment_link_id: LINK }),
    ],
    // La referencia de una transacción de link la genera Wompi: se asocia por payment_link_id.
    tx: { reference: 'test_LINK1_1760000000_x1', payment_link_id: LINK, amount_in_cents: 3_000_000, ...o.tx },
    stockOk: o.stockOk,
  });
}

describe('job wompi.transaccion: abono de contra entrega (purpose cod_deposit, §13.1)', () => {
  it('APPROVED en esperando_abono: abono_pagado con paid_at, stock y canje confirmados, recordatorios cancelados, transportadora', async () => {
    const s = abono();
    const r = await s.correr();
    expect(r).toEqual({ accion: 'abono_pagado', order_id: ORDER });
    expect(s.pagos[0]).toMatchObject({ status: 'approved', provider_transaction_id: TX_ID });
    expect(s.pedido.status).toBe('abono_pagado');
    expect(s.registro.eventos).toHaveLength(1);
    expect(s.registro.eventos[0]).toMatchObject({
      from_status: 'esperando_abono',
      to_status: 'abono_pagado',
      actor: 'webhook:wompi',
      payload: { payment_id: 'abono-1', transaction_id: TX_ID },
    });
    expect(s.registro.stockConfirmado).toBe(1);
    expect(s.registro.canjeConfirmado).toBe(1);
    expect(s.registro.codCancelado).toEqual([ORDER]);
    expect(s.registro.transportadora).toEqual([ORDER]);
    expect(s.registro.webhooks).toEqual([{ ok: true }]);
  });

  it('doble entrega: una sola transición; los pasos siguientes se repiten idempotentes', async () => {
    const s = abono();
    await s.correr();
    const r2 = await s.correr();
    expect(r2.accion).toBe('ya_pagado');
    expect(s.registro.eventos).toHaveLength(1);
    expect(s.registro.transportadora).toEqual([ORDER, ORDER]);
  });

  it('el monto del abono no coincide → no aprueba y alerta', async () => {
    const s = abono({ tx: { amount_in_cents: 2_000_000 } });
    const r = await s.correr();
    expect(r.accion).toBe('monto_no_coincide');
    expect(s.pedido.status).toBe('esperando_abono');
    expect(s.registro.alertas).toEqual(['monto_no_coincide']);
    expect(s.registro.codCancelado).toEqual([]);
  });

  it('DECLINED o ERROR del abono: el pedido sigue esperando (el link admite otro intento), sin pago_rechazado', async () => {
    for (const status of ['DECLINED', 'ERROR'] as const) {
      const s = abono({ tx: { status } });
      const r = await s.correr();
      expect(r.accion).toBe('sin_cambio');
      expect(s.pedido.status).toBe('esperando_abono');
      expect(s.pagos[0]!.status).toBe(status === 'DECLINED' ? 'declined' : 'error');
      expect(s.registro.eventos).toEqual([]);
    }
  });

  it('abono tardío sobre abandonado con stock: se reactiva a abono_pagado y sigue a la transportadora', async () => {
    const s = abono({ pedido: { status: 'abandonado', stock_state: 'released' } });
    const r = await s.correr();
    expect(r.accion).toBe('abono_pagado');
    expect(s.registro.eventos.map((e) => `${e.from_status}>${e.to_status}`)).toEqual(['abandonado>abono_pagado']);
    expect(s.registro.alertas).toContain('abono_tardio_reactivado');
    expect(s.registro.transportadora).toEqual([ORDER]);
  });

  it('abono tardío sobre abandonado sin stock: requiere_reembolso con alerta y sin transportadora', async () => {
    const s = abono({ pedido: { status: 'abandonado', stock_state: 'released' }, stockOk: false });
    const r = await s.correr();
    expect(r.accion).toBe('requiere_reembolso');
    expect(s.pedido.status).toBe('requiere_reembolso');
    expect(s.registro.alertas).toContain('abono_tardio_sin_stock');
    expect(s.registro.transportadora).toEqual([]);
  });

  it('segundo abono aprobado (otro link) → alerta pago_duplicado sin transición', async () => {
    const s = abono({
      pedido: { status: 'abono_pagado' },
      pagos: [
        pago({ id: 'abono-0', purpose: 'cod_deposit', amount: 30_000n, status: 'approved', provider_reference: 'IZ-CO-000123-A0', payment_link_id: 'test_OTRO', provider_transaction_id: 'otra' }),
        pago({ id: 'abono-1', purpose: 'cod_deposit', amount: 30_000n, provider_reference: 'IZ-CO-000123-A1', payment_link_id: LINK }),
      ],
    });
    const r = await s.correr();
    expect(r.accion).toBe('pago_duplicado');
    expect(s.registro.alertas).toEqual(['pago_duplicado']);
    expect(s.registro.eventos).toEqual([]);
  });

  it('abono en un pedido que no es de contra entrega → alerta y no transiciona', async () => {
    const s = abono({ pedido: { payment_method: 'wompi', status: 'pendiente_pago' } });
    const r = await s.correr();
    expect(r.accion).toBe('estado_inesperado');
    expect(s.registro.alertas).toEqual(['proposito_no_coincide']);
    expect(s.pedido.status).toBe('pendiente_pago');
  });

  it('conflicto de estado concurrente → reintentable, sin cancelar recordatorios ni encolar', async () => {
    const s = abono();
    s.registro.conflictoUnaVez = true;
    await expect(s.correr()).rejects.toBeInstanceOf(ErrorReintentable);
    expect(s.registro.transportadora).toEqual([]);
    expect(s.registro.codCancelado).toEqual([]);
  });
});
