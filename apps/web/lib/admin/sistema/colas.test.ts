import { describe, expect, it, vi } from 'vitest';
import { COLAS, estadoColas, esNombreCola, reintentarJobFallido, type ColaMinima, type JobFallido } from './colas';

const fallido = (id: string, motivo = 'boom'): JobFallido => ({ id, name: 'wompi.evento', failedReason: motivo, attemptsMade: 3, finishedOn: Date.UTC(2026, 9, 20), retry: vi.fn(async () => {}) });

function cola(o: Partial<ColaMinima> = {}): ColaMinima {
  return {
    getJobCounts: vi.fn(async () => ({ waiting: 1, active: 2, delayed: 3, failed: 1, completed: 40 })),
    getFailed: vi.fn(async () => [fallido('j1')]),
    getJob: vi.fn(async () => null),
    ...o,
  };
}

describe('estadoColas', () => {
  it('trae los conteos y los fallidos de las cinco colas conocidas', async () => {
    const pedidas: string[] = [];
    const r = await estadoColas((n) => {
      pedidas.push(n);
      return cola();
    });
    expect(pedidas.sort()).toEqual(COLAS.map((c) => c.nombre).sort());
    expect(r.disponible).toBe(true);
    if (!r.disponible) return;
    expect(r.colas[0]!.conteos).toEqual({ waiting: 1, active: 2, delayed: 3, failed: 1, completed: 40 });
    expect(r.colas[0]!.fallidos[0]).toMatchObject({ id: 'j1', job: 'wompi.evento', intentos: 3, cuando: '2026-10-20T00:00:00.000Z' });
  });

  it('recorta el motivo largo del fallo', async () => {
    const r = await estadoColas(() => cola({ getFailed: vi.fn(async () => [fallido('j', 'x'.repeat(1000))]) }));
    expect(r.disponible && r.colas[0]!.fallidos[0]!.motivo).toHaveLength(200);
  });

  it('si Redis falla, lo dice en vez de lanzar', async () => {
    const r = await estadoColas(() => cola({ getJobCounts: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) }));
    expect(r).toEqual({ disponible: false, motivo: expect.stringMatching(/Redis/) });
  });

  it('si no hay REDIS_URL tampoco lanza', async () => {
    const r = await estadoColas(() => {
      throw new Error('REDIS_URL no está definida');
    });
    expect(r.disponible).toBe(false);
  });
});

describe('reintentarJobFallido', () => {
  const conJob = (fallo: boolean) => {
    const job = { ...fallido('j1'), isFailed: vi.fn(async () => fallo) };
    return { job, fabrica: () => cola({ getJob: vi.fn(async () => job) }) };
  };

  it('reintenta un job fallido de una cola conocida', async () => {
    const { job, fabrica } = conJob(true);
    expect(await reintentarJobFallido('pagos', 'j1', fabrica)).toEqual({ ok: true });
    expect(job.retry).toHaveBeenCalledTimes(1);
  });

  it('no reintenta lo que no está fallido, no existe o es de una cola desconocida', async () => {
    const noFallido = conJob(false);
    expect(await reintentarJobFallido('pagos', 'j1', noFallido.fabrica)).toMatchObject({ ok: false });
    expect(noFallido.job.retry).not.toHaveBeenCalled();
    expect(await reintentarJobFallido('pagos', 'j1', () => cola())).toMatchObject({ ok: false, mensaje: expect.stringMatching(/ya no existe/) });
    const f = vi.fn(() => cola());
    expect(await reintentarJobFallido('otra', 'j1', f)).toMatchObject({ ok: false });
    expect(await reintentarJobFallido('pagos', 'j 1; drop', f)).toMatchObject({ ok: false });
    expect(f).not.toHaveBeenCalled();
    expect(esNombreCola('carrier')).toBe(true);
    expect(esNombreCola('otra')).toBe(false);
  });
});
