import { describe, expect, it } from 'vitest';
import {
  DEBOUNCE_RECALCULO_MS,
  JOB_METRICS_RECOMPUTE_DAY,
  encolarRecalculoDia,
  encolarRecalculoPedido,
  fechasAfectadas,
  fechasPedidoDeFila,
  idDeduplicacionRecalculo,
  opcionesRecalculo,
  type ColaRecalculo,
} from './cola';

function colaFalsa() {
  const llamadas: [string, unknown, unknown][] = [];
  const cola: ColaRecalculo = {
    async add(nombre, datos, opciones) {
      llamadas.push([nombre, datos, opciones]);
    },
  };
  return { cola, llamadas };
}

describe('contrato del productor de metrics.recompute_day (D-033)', () => {
  it('nombre, id de deduplicación y opciones (debounce 1 min, sin jobId fijo)', () => {
    expect(JOB_METRICS_RECOMPUTE_DAY).toBe('metrics.recompute_day');
    expect(DEBOUNCE_RECALCULO_MS).toBe(60_000);
    expect(idDeduplicacionRecalculo('2026-10-20', 'CO')).toBe('metrics.recompute_day.2026-10-20.CO');
    const o = opcionesRecalculo('2026-10-20', 'EC', DEBOUNCE_RECALCULO_MS);
    expect(o).toMatchObject({
      delay: 60_000,
      deduplication: { id: 'metrics.recompute_day.2026-10-20.EC', keepLastIfActive: true },
      attempts: 5,
    });
    expect(o).not.toHaveProperty('jobId');
  });

  it('fechasAfectadas: creación y pago en Bogotá, sin repetir', () => {
    expect(fechasAfectadas({ created_at: new Date('2026-10-21T04:30:00Z'), paid_at: new Date('2026-10-21T13:00:00Z') })).toEqual([
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(fechasAfectadas({ created_at: new Date('2026-10-20T15:00:00Z'), paid_at: null })).toEqual(['2026-10-20']);
  });

  it('encolarRecalculoPedido encola un job por día afectado', async () => {
    const { cola, llamadas } = colaFalsa();
    await encolarRecalculoPedido(cola, {
      country_code: 'CO',
      created_at: new Date('2026-10-20T04:00:00Z'),
      paid_at: new Date('2026-10-20T15:00:00Z'),
    });
    expect(llamadas.map(([n, d]) => [n, d])).toEqual([
      [JOB_METRICS_RECOMPUTE_DAY, { date: '2026-10-19', country_code: 'CO' }],
      [JOB_METRICS_RECOMPUTE_DAY, { date: '2026-10-20', country_code: 'CO' }],
    ]);
  });

  it('rechaza fecha o país inválidos sin encolar', async () => {
    const { cola, llamadas } = colaFalsa();
    await expect(encolarRecalculoDia(cola, '2026-13-01', 'CO')).rejects.toThrow(RangeError);
    await expect(encolarRecalculoDia(cola, '2026-10-20', 'PE' as never)).rejects.toThrow(RangeError);
    expect(llamadas).toHaveLength(0);
  });

  it('fechasPedidoDeFila: lee la fila de orders y descarta lo que no cuadra', () => {
    expect(fechasPedidoDeFila({ country_code: 'CO', created_at: '2026-10-20T15:00:00Z', paid_at: null })).toEqual({
      country_code: 'CO',
      created_at: new Date('2026-10-20T15:00:00Z'),
      paid_at: null,
    });
    expect(fechasPedidoDeFila({ country_code: 'EC', created_at: '2026-10-20T15:00:00Z', paid_at: '2026-10-21T01:00:00Z' })?.paid_at).toEqual(
      new Date('2026-10-21T01:00:00Z'),
    );
    expect(fechasPedidoDeFila({ country_code: 'PE', created_at: '2026-10-20T15:00:00Z', paid_at: null })).toBeNull();
    expect(fechasPedidoDeFila({ country_code: 'CO', created_at: 'x', paid_at: null })).toBeNull();
    expect(fechasPedidoDeFila({ country_code: 'CO', created_at: '2026-10-20T15:00:00Z', paid_at: 'x' })).toBeNull();
    expect(fechasPedidoDeFila(null)).toBeNull();
  });
});
