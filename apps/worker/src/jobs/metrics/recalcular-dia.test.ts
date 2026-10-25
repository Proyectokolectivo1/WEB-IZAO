import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { filasVentasDiarias, METODOS_PAGO, type FilaVentasDiarias, type PedidoMetrica } from '@izao/core/metrics';
import {
  crearManejadorRecalculoDia,
  crearManejadorRecalculoReciente,
  DEBOUNCE_RECALCULO_MS,
  encolarRecalculoDia,
  encolarRecalculoPedido,
  fechasAfectadas,
  idDeduplicacionRecalculo,
  JOB_METRICS_RECOMPUTE_DAY,
  recalcularDia,
  type FuenteMetricas,
} from './recalcular-dia.js';

function pedido(p: Partial<PedidoMetrica> & Pick<PedidoMetrica, 'id' | 'metodo' | 'estado'>): PedidoMetrica {
  return {
    pais: 'CO',
    moneda: 'COP',
    creadoEn: new Date('2026-10-20T15:00:00Z'),
    pagadoEn: new Date('2026-10-20T15:05:00Z'),
    total: 200_000n,
    descuento: 0n,
    recargo: 0n,
    abono: 0n,
    recaudo: 0n,
    costoProducto: 80_000n,
    comisionPasarela: 7_000n,
    comisionPlataforma: 1_500n,
    envioReal: 12_000n,
    tarifaEnvio: null,
    envioEstimadoPais: 14_000n,
    ...p,
  };
}

const PEDIDOS: PedidoMetrica[] = [
  pedido({ id: 'a', metodo: 'wompi', estado: 'entregado' }),
  pedido({ id: 'b', metodo: 'addi', estado: 'en_transito', recargo: 20_000n, total: 220_000n, envioReal: null, tarifaEnvio: 11_000n }),
  pedido({ id: 'c', metodo: 'cod', estado: 'entregado', abono: 30_000n, recaudo: 170_000n }),
  pedido({ id: 'd', metodo: 'cod', estado: 'abandonado', pagadoEn: null, abono: 30_000n, recaudo: 170_000n }),
];

function fuenteMemoria(pedidos: PedidoMetrica[]) {
  const guardadas = new Map<string, FilaVentasDiarias>();
  const fuente: FuenteMetricas = {
    pedidosDelDia: vi.fn(async () => pedidos),
    guardarFilas: vi.fn(async (filas: FilaVentasDiarias[]) => {
      for (const f of filas) guardadas.set(`${f.date}|${f.country_code}|${f.payment_method}`, f);
    }),
  };
  return { fuente, guardadas };
}

const job = (data: unknown, name = JOB_METRICS_RECOMPUTE_DAY) => ({ name, data, id: '1' }) as unknown as Job;

describe('metrics.recompute_day (§21.4)', () => {
  it('escribe las 5 filas completas del día y país con FilaVentasDiarias', async () => {
    const { fuente, guardadas } = fuenteMemoria(PEDIDOS);
    const r = await recalcularDia({ fuente }, { date: '2026-10-20', country_code: 'CO' });
    expect(fuente.pedidosDelDia).toHaveBeenCalledWith('2026-10-20', 'CO');
    expect(r).toEqual({ ok: true, date: '2026-10-20', country_code: 'CO', filas: 5, pedidos: 4 });
    const esperadas = filasVentasDiarias(PEDIDOS, '2026-10-20', 'CO');
    expect([...guardadas.values()]).toEqual(esperadas);
    expect([...guardadas.values()].map((f) => f.payment_method).sort()).toEqual([...METODOS_PAGO].sort());
    const cod = guardadas.get('2026-10-20|CO|cod')!;
    expect(cod.orders_abandoned).toBe(1);
    expect(cod.confirmed_revenue).toBe(200_000n);
    const addi = guardadas.get('2026-10-20|CO|addi')!;
    expect(addi.shipping_estimated_count).toBe(1);
    expect(addi.carrier_platform_fees).toBe(1_500n);
  });

  it('idempotente: repetir el job deja exactamente las mismas filas', async () => {
    const { fuente, guardadas } = fuenteMemoria(PEDIDOS);
    await recalcularDia({ fuente }, { date: '2026-10-20', country_code: 'CO' });
    const primera = structuredClone([...guardadas.values()]);
    await recalcularDia({ fuente }, { date: '2026-10-20', country_code: 'CO' });
    expect([...guardadas.values()]).toEqual(primera);
    expect(guardadas.size).toBe(5);
  });

  it('día sin pedidos: 5 filas en cero (pisa valores viejos)', async () => {
    const { fuente, guardadas } = fuenteMemoria([]);
    await recalcularDia({ fuente }, { date: '2026-10-21', country_code: 'EC' });
    expect(guardadas.size).toBe(5);
    for (const f of guardadas.values()) {
      expect(f.currency_code).toBe('USD');
      expect(f.orders_created).toBe(0);
      expect(f.confirmed_revenue).toBe(0n);
    }
  });

  it('datos inválidos → UnrecoverableError (sin reintentos) y no toca la base', async () => {
    const { fuente } = fuenteMemoria(PEDIDOS);
    const procesar = crearManejadorRecalculoDia({ fuente });
    for (const d of [null, {}, { date: '2026-13-01', country_code: 'CO' }, { date: '2026-10-20', country_code: 'PE' }, { date: '20-10-2026', country_code: 'CO' }]) {
      await expect(procesar(job(d))).rejects.toBeInstanceOf(UnrecoverableError);
    }
    expect(fuente.pedidosDelDia).not.toHaveBeenCalled();
    expect(fuente.guardarFilas).not.toHaveBeenCalled();
  });

  it('un pedido que no se atribuye al día es error de datos (UnrecoverableError), no se escribe nada', async () => {
    const ajeno = pedido({ id: 'x', metodo: 'wompi', estado: 'pagado', pagadoEn: new Date('2026-10-22T15:00:00Z') });
    const { fuente } = fuenteMemoria([ajeno]);
    await expect(crearManejadorRecalculoDia({ fuente })(job({ date: '2026-10-20', country_code: 'CO' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(fuente.guardarFilas).not.toHaveBeenCalled();
  });

  it('fallo de la fuente se propaga para que BullMQ reintente', async () => {
    const { fuente } = fuenteMemoria(PEDIDOS);
    fuente.pedidosDelDia = vi.fn(async () => {
      throw new Error('PostgREST orders respondió HTTP 503');
    });
    const e = await crearManejadorRecalculoDia({ fuente })(job({ date: '2026-10-20', country_code: 'CO' })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(UnrecoverableError);
  });
});

function colaFalsa() {
  const add = vi.fn(async () => ({}));
  return { cola: { add } as unknown as Queue, add };
}

describe('encolado con debounce por fecha y país', () => {
  it('id de deduplicación por fecha+país (sin ":"), espera de 1 min, sin dos cálculos simultáneos', async () => {
    const { cola, add } = colaFalsa();
    await encolarRecalculoDia(cola, '2026-10-20', 'CO');
    expect(idDeduplicacionRecalculo('2026-10-20', 'CO')).toBe('metrics.recompute_day.2026-10-20.CO');
    expect(DEBOUNCE_RECALCULO_MS).toBe(60_000);
    expect(add).toHaveBeenCalledWith(
      JOB_METRICS_RECOMPUTE_DAY,
      { date: '2026-10-20', country_code: 'CO' },
      expect.objectContaining({
        delay: 60_000,
        deduplication: { id: 'metrics.recompute_day.2026-10-20.CO', keepLastIfActive: true },
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
      }),
    );
    const opciones = (add.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(opciones.jobId).toBeUndefined();
  });

  it('rechaza fecha o país inválidos al encolar', async () => {
    const { cola, add } = colaFalsa();
    await expect(encolarRecalculoDia(cola, '2026-02-30', 'CO')).rejects.toThrow(RangeError);
    await expect(encolarRecalculoDia(cola, '2026-10-20', 'PE' as never)).rejects.toThrow(RangeError);
    expect(add).not.toHaveBeenCalled();
  });

  it('fechasAfectadas: día de creación y de pago en Bogotá, sin repetir', () => {
    // Creado el 20 a las 23:30 de Bogotá (04:30Z del 21) y pagado el 21 a las 08:00 de Bogotá.
    expect(fechasAfectadas({ created_at: new Date('2026-10-21T04:30:00Z'), paid_at: new Date('2026-10-21T13:00:00Z') })).toEqual([
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(fechasAfectadas({ created_at: new Date('2026-10-20T15:00:00Z'), paid_at: null })).toEqual(['2026-10-20']);
    expect(fechasAfectadas({ created_at: new Date('2026-10-20T15:00:00Z'), paid_at: new Date('2026-10-20T16:00:00Z') })).toEqual([
      '2026-10-20',
    ]);
  });

  it('encolarRecalculoPedido encola cada fecha afectada del país del pedido', async () => {
    const { cola, add } = colaFalsa();
    await encolarRecalculoPedido(cola, {
      country_code: 'EC',
      created_at: new Date('2026-10-21T04:30:00Z'),
      paid_at: new Date('2026-10-21T13:00:00Z'),
    });
    expect(add.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { date: '2026-10-20', country_code: 'EC' },
      { date: '2026-10-21', country_code: 'EC' },
    ]);
  });

  it('nocturno: encola los últimos 60 días (incluido hoy en Bogotá) por país, sin espera', async () => {
    const { cola, add } = colaFalsa();
    const r = await crearManejadorRecalculoReciente(cola, () => new Date('2026-10-24T03:00:00Z'))(job({}, 'metrics.recompute_recent'));
    expect(r).toEqual({ ok: true, encolados: 120 });
    const datos = add.mock.calls.map((c) => (c as unknown[])[1] as { date: string; country_code: string });
    expect(datos[0]).toEqual({ date: '2026-10-23', country_code: 'CO' });
    expect(datos.filter((d) => d.country_code === 'CO').at(-1)).toEqual({ date: '2026-08-25', country_code: 'CO' });
    expect(new Set(datos.map((d) => `${d.date}.${d.country_code}`)).size).toBe(120);
    for (const c of add.mock.calls) expect(((c as unknown[])[2] as { delay: number }).delay).toBe(0);
  });
});
