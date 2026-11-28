import { describe, expect, it } from 'vitest';
import type { OrderStatusEvent } from '@izao/core/order-state';
import { crearClienteWompi, type WompiCredentials } from '@izao/wompi';
import { LLAVE_PRIVADA_PRUEBA, fetchWompiFalso, type TransaccionPrueba } from '@izao/wompi/mock';
import {
  ESTADOS_COBRO,
  MAX_FALLAS_SEGUIDAS,
  crearConciliadorWompi,
  enTurno,
  type DepsConciliacion,
  type PagoPorConciliar,
} from './conciliacion.js';
import type { FuentePagosWorker, PagoFila, PedidoFila } from './fuente.js';
import { procesarTransaccionWompi } from './wompi-transaccion.js';

const CREDS: WompiCredentials = {
  ambiente: 'sandbox',
  llavePublica: 'pub_test_ficticia',
  llavePrivada: LLAVE_PRIVADA_PRUEBA,
  secretoEventos: 'test_events_ficticio',
  secretoIntegridad: 'test_integrity_ficticio',
};
const AHORA = new Date('2026-11-27T20:00:00.000Z');
const HACE_15H = '2026-11-27T05:00:00.000Z';
const HACE_10M = '2026-11-27T19:50:00.000Z';
const P52 = '00000000-0000-4000-8000-000000000052';
const P51 = '00000000-0000-4000-8000-000000000051';
const LINK = 'test_lnk_51';

function pedido(id: string, o: Partial<PedidoFila>): PedidoFila {
  return {
    id,
    number: `IZ-CO-0000${id.slice(-2)}`,
    status: 'pendiente_pago',
    country_code: 'CO',
    currency_code: 'COP',
    payment_method: 'wompi',
    stock_state: 'reserved',
    ...o,
  };
}

function pago(o: Partial<PagoFila>): PagoFila {
  return {
    id: 'pago-52',
    order_id: P52,
    provider: 'wompi',
    purpose: 'full',
    amount: 169_900n,
    currency_code: 'COP',
    status: 'created',
    provider_reference: 'IZ-CO-000052-P1',
    provider_transaction_id: null,
    payment_link_id: null,
    created_at: HACE_10M,
    ...o,
  };
}

/** Pedido 52 (pago completo expirado) y 51 (abono en esperando_abono), como el incidente del 27/11. */
function escenario(
  o: { pedidos?: PedidoFila[]; pagos?: PagoFila[]; txs?: TransaccionPrueba[]; stockOk?: boolean; sinCreds?: boolean } = {},
) {
  const pedidos = new Map(
    (o.pedidos ?? [pedido(P52, { status: 'expirado', stock_state: 'released' })]).map((p) => [p.id, p]),
  );
  const pagos = o.pagos ?? [pago({})];
  const red = fetchWompiFalso(o.txs ?? [{ id: 'tx-52', status: 'APPROVED', amount_in_cents: 16_990_000, reference: 'IZ-CO-000052-P1' }]);
  const reg = {
    eventos: [] as (OrderStatusEvent & { order_id: string })[],
    alertas: [] as { order_id: string; motivo: string; payload: Record<string, string | null> }[],
    webhooks: 0,
    stock: 0,
    canje: 0,
    transportadora: [] as string[],
    codCancelado: [] as string[],
  };
  const fuente: FuentePagosWorker & { pagosPorConciliar: DepsConciliacion['fuente']['pagosPorConciliar'] } = {
    credencialesWompi: async () => (o.sinCreds ? null : CREDS),
    pagosPorReferencia: async (ref) => pagos.filter((p) => p.provider_reference === ref),
    pagosPorLink: async (id) => pagos.filter((p) => p.payment_link_id === id),
    pagosDelPedido: async (id) => pagos.filter((p) => p.order_id === id),
    pedido: async (id) => {
      const p = pedidos.get(id);
      return p ? { ...p } : null;
    },
    actualizarPago: async (id, c) => {
      const p = pagos.find((x) => x.id === id)!;
      p.status = c.status;
      p.provider_transaction_id = c.provider_transaction_id;
    },
    comision: async () => ({ fee_pct: '2.65', fee_fixed: 700n, fee_tax_pct: '19' }),
    confirmarStock: async (id) => {
      const p = pedidos.get(id)!;
      if (p.stock_state === 'confirmed') return { ok: true, estado: 'confirmed', repetido: true };
      if (o.stockOk === false) return { ok: false, estado: p.stock_state, motivo: 'sin_stock', faltantes: [] };
      reg.stock += 1;
      p.stock_state = 'confirmed';
      return { ok: true, estado: 'confirmed' };
    },
    confirmarCanje: async () => {
      reg.canje += 1;
      return { ok: true, estado: 'sin_codigo' };
    },
    aplicarTransicion: async (id, ev) => {
      const p = pedidos.get(id)!;
      if (p.status === ev.to_status) return true; // reintento
      if (p.status !== ev.from_status) return false;
      p.status = ev.to_status;
      reg.eventos.push({ ...ev, order_id: id });
      return true;
    },
    // Igual que la fuente PostgREST: una alerta por (pedido, motivo, transacción).
    registrarAlerta: async (orderId, motivo, payload) => {
      const tx = payload.transaction_id ?? null;
      if (tx && reg.alertas.some((a) => a.order_id === orderId && a.motivo === motivo && a.payload.transaction_id === tx)) return;
      reg.alertas.push({ order_id: orderId, motivo, payload });
    },
    marcarWebhook: async () => {
      reg.webhooks += 1;
    },
    pagosPorConciliar: async (desde, limite) =>
      pagos
        .filter((p) => new Date(p.created_at) >= desde && ESTADOS_COBRO.includes(pedidos.get(p.order_id)!.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limite)
        .map((p): PagoPorConciliar => ({ ...p, order_status: pedidos.get(p.order_id)!.status })),
  };
  const deps: DepsConciliacion = {
    fuente,
    cliente: (c) => crearClienteWompi({ ambiente: c.ambiente, llavePrivada: c.llavePrivada, fetchImpl: red.fetch }),
    encolarTransportadora: async (id) => void reg.transportadora.push(id),
    cancelarJobsCod: async (id) => void reg.codCancelado.push(id),
    ahora: () => AHORA,
  };
  return { pedidos, pagos, red, reg, deps, conciliador: () => crearConciliadorWompi(deps) };
}

const motivos = (reg: { alertas: { motivo: string }[] }) => reg.alertas.map((a) => a.motivo);

describe('conciliación Wompi (respaldo del webhook, D-059)', () => {
  it('pedido 52: pago completo aprobado en Wompi sobre pedido expirado → re-reserva, pagado, MasterShop, sin tocar webhook_events', async () => {
    const s = escenario();
    const r = await s.conciliador().barrer();
    expect(r).toMatchObject({ revisados: 1, aplicados: 1, sin_aplicar: 0, errores: 0, wompi_caido: false });
    expect(s.pedidos.get(P52)!.status).toBe('pagado');
    expect(s.pagos[0]).toMatchObject({ status: 'approved', provider_transaction_id: 'tx-52' });
    expect(s.reg.stock).toBe(1);
    expect(s.reg.eventos.map((e) => [e.from_status, e.to_status])).toEqual([['expirado', 'pagado']]);
    expect(s.reg.eventos[0]!.payload).toMatchObject({ origen: 'conciliacion', transaction_id: 'tx-52' });
    expect(s.reg.transportadora).toEqual([P52]);
    expect(motivos(s.reg)).toEqual(['pago_tardio_reactivado']);
    expect(s.reg.webhooks).toBe(0);
    // Búsqueda por referencia y luego reconsulta por id (mismo camino del webhook).
    expect(s.red.llamadas.map((l) => new URL(l.url).pathname)).toEqual(['/v1/transactions', '/v1/transactions/tx-52']);
    expect(new URL(s.red.llamadas[0]!.url).searchParams.get('reference')).toBe('IZ-CO-000052-P1');
  });

  it('pedido 51: abono aprobado por link (búsqueda por fechas filtrando payment_link_id) → abono_pagado, recordatorios cancelados, MasterShop', async () => {
    const s = escenario({
      pedidos: [pedido(P51, { status: 'esperando_abono', payment_method: 'cod' })],
      pagos: [pago({ id: 'abono-51', order_id: P51, purpose: 'cod_deposit', amount: 15_000n, provider_reference: 'IZ-CO-000051-A1', payment_link_id: LINK, created_at: HACE_15H })],
      txs: [
        { id: 'tx-otro', status: 'APPROVED', amount_in_cents: 9_900_000, reference: 'otra-ref', payment_link_id: 'test_lnk_otro' },
        { id: 'tx-51', status: 'APPROVED', amount_in_cents: 1_500_000, reference: 'ref-generada-por-wompi', payment_link_id: LINK },
      ],
    });
    // 15 h de antigüedad: se fuerza (antes de vencer) con conciliarPedido, sin depender del turno.
    expect(await s.conciliador().conciliarPedido(P51)).toBe('conciliado');
    expect(s.pedidos.get(P51)!.status).toBe('abono_pagado');
    expect(s.pagos[0]).toMatchObject({ status: 'approved', provider_transaction_id: 'tx-51' });
    expect(s.reg.codCancelado).toEqual([P51]);
    expect(s.reg.transportadora).toEqual([P51]);
    const busqueda = new URL(s.red.llamadas[0]!.url).searchParams;
    expect(busqueda.get('from_date')).toBe('2026-11-24');
    expect(busqueda.get('until_date')).toBe('2026-11-28');
    expect(busqueda.get('page')).toBe('1');
  });

  it('idempotente: dos corridas (o webhook y conciliación) no duplican transición, stock, alertas ni efectos', async () => {
    const s = escenario({ pedidos: [pedido(P52, { status: 'pendiente_pago' })] });
    await s.conciliador().barrer();
    await s.conciliador().barrer();
    await procesarTransaccionWompi({ event_id: 'tx-52.APPROVED', transaction_id: 'tx-52' }, s.deps);
    expect(s.reg.eventos).toHaveLength(1);
    expect(s.reg.stock).toBe(1);
    expect(s.pedidos.get(P52)!.status).toBe('pagado');
    expect(s.reg.alertas).toEqual([]);
    // Tras pagar, el pedido sale de los estados de cobro: la segunda corrida ya no lo consulta.
    expect(s.red.llamadas.filter((l) => l.url.includes('reference='))).toHaveLength(1);
    // `carrier.create` con id fijo por pedido: repetir el encolado no crea otro job.
    expect(new Set(s.reg.transportadora)).toEqual(new Set([P52]));
  });

  it('monto no coincide → no aprueba ni transiciona; alertas monto_no_coincide y pago_aprobado_sin_aplicar una sola vez', async () => {
    const s = escenario({
      pedidos: [pedido(P52, { status: 'pendiente_pago' })],
      txs: [{ id: 'tx-52', status: 'APPROVED', amount_in_cents: 100_000, reference: 'IZ-CO-000052-P1' }],
    });
    await s.conciliador().barrer();
    await s.conciliador().barrer();
    expect(s.pedidos.get(P52)!.status).toBe('pendiente_pago');
    expect(s.pagos[0]!.status).toBe('created');
    expect(s.reg.eventos).toEqual([]);
    expect(s.reg.transportadora).toEqual([]);
    expect(motivos(s.reg)).toEqual(['monto_no_coincide', 'pago_aprobado_sin_aplicar']);
    expect(s.reg.alertas[1]!.payload).toMatchObject({ transaction_id: 'tx-52', motivo_job: 'monto_no_coincide' });
  });

  it('pago tardío sin stock → requiere_reembolso con alerta; nunca se pierde el pago', async () => {
    const s = escenario({ stockOk: false });
    const r = await s.conciliador().barrer();
    expect(s.pedidos.get(P52)!.status).toBe('requiere_reembolso');
    expect(s.pagos[0]!.status).toBe('approved');
    expect(motivos(s.reg)).toEqual(['pago_tardio_sin_stock']);
    expect(s.reg.transportadora).toEqual([]);
    expect(r.sin_aplicar).toBe(0); // requiere_reembolso ya deja su propia alerta
  });

  it('aprobado sin stock en pendiente_pago → alerta pago_aprobado_sin_aplicar y se reintenta en la siguiente corrida', async () => {
    const s = escenario({ pedidos: [pedido(P52, { status: 'pendiente_pago' })], stockOk: false });
    const r = await s.conciliador().barrer();
    expect(r.sin_aplicar).toBe(1);
    expect(motivos(s.reg)).toEqual(['sin_stock_al_aprobar', 'pago_aprobado_sin_aplicar']);
    // El pago quedó approved pero el pedido sigue en cobro: la siguiente corrida lo vuelve a intentar.
    await s.conciliador().barrer();
    expect(s.red.llamadas.filter((l) => l.url.includes('reference='))).toHaveLength(2);
    expect(motivos(s.reg)).toEqual(['sin_stock_al_aprobar', 'pago_aprobado_sin_aplicar']);
  });

  it('PENDING en Wompi → no hace nada; DECLINED en pendiente_pago → pago_rechazado (como el webhook)', async () => {
    const pend = escenario({ pedidos: [pedido(P52, { status: 'pendiente_pago' })], txs: [{ id: 'tx-52', status: 'PENDING', amount_in_cents: 16_990_000, reference: 'IZ-CO-000052-P1' }] });
    await pend.conciliador().barrer();
    expect(pend.pedidos.get(P52)!.status).toBe('pendiente_pago');
    expect(pend.red.llamadas).toHaveLength(1); // solo la búsqueda
    const rech = escenario({ pedidos: [pedido(P52, { status: 'pendiente_pago' })], txs: [{ id: 'tx-52', status: 'DECLINED', amount_in_cents: 16_990_000, reference: 'IZ-CO-000052-P1' }] });
    await rech.conciliador().barrer();
    expect(rech.pedidos.get(P52)!.status).toBe('pago_rechazado');
    await rech.conciliador().barrer();
    expect(rech.red.llamadas.filter((l) => l.url.endsWith('/tx-52'))).toHaveLength(1); // el rechazo ya reflejado no se reprocesa
  });

  it('un reintento aprobado con la misma referencia después de un rechazo sí se aplica', async () => {
    const s = escenario({
      pedidos: [pedido(P52, { status: 'pago_rechazado' })],
      pagos: [pago({ status: 'declined', provider_transaction_id: 'tx-a' })],
      txs: [
        { id: 'tx-a', status: 'DECLINED', amount_in_cents: 16_990_000, reference: 'IZ-CO-000052-P1' },
        { id: 'tx-b', status: 'APPROVED', amount_in_cents: 16_990_000, reference: 'IZ-CO-000052-P1' },
      ],
    });
    await s.conciliador().barrer();
    expect(s.pedidos.get(P52)!.status).toBe('pagado');
    expect(s.pagos[0]).toMatchObject({ status: 'approved', provider_transaction_id: 'tx-b' });
  });

  it('Wompi caído: corta tras MAX_FALLAS_SEGUIDAS, no transiciona y conciliarPedido devuelve fallo', async () => {
    const pagos = Array.from({ length: 6 }, (_, i) => pago({ id: `p-${i}`, provider_reference: `IZ-CO-00005${i}-P1` }));
    const s = escenario({ pedidos: [pedido(P52, { status: 'pendiente_pago' })], pagos });
    s.red.caido = true;
    const c = s.conciliador();
    const r = await c.barrer();
    expect(r.wompi_caido).toBe(true);
    expect(s.red.llamadas).toHaveLength(MAX_FALLAS_SEGUIDAS);
    expect(r.errores).toBe(MAX_FALLAS_SEGUIDAS);
    expect(s.reg.eventos).toEqual([]);
    expect(await c.conciliarPedido(P52)).toBe('fallo');
    expect(s.red.llamadas).toHaveLength(MAX_FALLAS_SEGUIDAS); // ya no insiste en esta corrida
  });

  it('sin credenciales → fallo sin llamar a la red', async () => {
    const s = escenario({ sinCreds: true });
    const c = s.conciliador();
    const r = await c.barrer();
    expect(r).toMatchObject({ wompi_caido: true, errores: 1 });
    expect(await c.conciliarPedido(P52)).toBe('fallo');
    expect(s.red.llamadas).toHaveLength(0);
    expect(s.pedidos.get(P52)!.status).toBe('expirado');
  });

  it('ritmo: pagos de menos de 3 h en cada corrida; los viejos solo en su turno (una vez cada 30 min)', async () => {
    const instantes = Array.from({ length: 15 }, (_, i) => new Date(AHORA.getTime() + i * 120_000));
    const turnos = instantes.map((t) => enTurno('viejo', t));
    expect(turnos.filter(Boolean)).toHaveLength(1);
    const fuera = escenario({ pagos: [pago({ id: 'viejo', created_at: HACE_15H })] });
    fuera.deps.ahora = () => instantes[turnos.indexOf(false)]!;
    expect(await fuera.conciliador().barrer()).toMatchObject({ revisados: 0, omitidos: 1 });
    expect(fuera.red.llamadas).toHaveLength(0);
    const dentro = escenario({ pagos: [pago({ id: 'viejo', created_at: HACE_15H })] });
    dentro.deps.ahora = () => instantes[turnos.indexOf(true)]!;
    expect(await dentro.conciliador().barrer()).toMatchObject({ revisados: 1, aplicados: 1 });
    const reciente = escenario({ pagos: [pago({ id: 'viejo', created_at: HACE_10M })] });
    reciente.deps.ahora = () => instantes[turnos.indexOf(false)]!;
    expect(await reciente.conciliador().barrer()).toMatchObject({ revisados: 1 });
  });

  it('ventana de 48 h: pagos más viejos no se consultan', async () => {
    const s = escenario({ pagos: [pago({ created_at: '2026-11-25T19:00:00.000Z' })] });
    const r = await s.conciliador().barrer();
    expect(r.revisados).toBe(0);
    expect(s.red.llamadas).toHaveLength(0);
  });
});
