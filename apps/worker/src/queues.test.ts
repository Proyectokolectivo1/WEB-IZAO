import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { createConnection, crearProcesadorSistema, QUEUE_NAMES } from './queues.js';

describe('queues', () => {
  it('expone la cola de sistema', () => {
    expect(QUEUE_NAMES.sistema).toBe('sistema');
  });

  it('expone las colas de pagos y contra entrega', () => {
    expect(QUEUE_NAMES.pagos).toBe('pagos');
    expect(QUEUE_NAMES.contraentrega).toBeTruthy();
  });

  it('exige REDIS_URL', () => {
    expect(() => createConnection('')).toThrow('REDIS_URL');
  });
});

describe('crearProcesadorSistema métricas', () => {
  it('despacha metrics.recompute_day y metrics.recompute_recent a su manejador', async () => {
    const dia = vi.fn().mockResolvedValue({ ok: true, d: 1 });
    const reciente = vi.fn().mockResolvedValue({ ok: true, r: 1 });
    const p = crearProcesadorSistema({ 'metrics.recompute_day': dia, 'metrics.recompute_recent': reciente });
    await p({ name: 'metrics.recompute_day', data: {} } as Job, 't');
    await p({ name: 'metrics.recompute_recent', data: {} } as Job, 't');
    expect(dia).toHaveBeenCalledTimes(1);
    expect(reciente).toHaveBeenCalledTimes(1);
  });
});
