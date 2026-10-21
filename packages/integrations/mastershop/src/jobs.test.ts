import { describe, expect, it } from 'vitest';
import { JOB_CARRIER_CREATE, jobIdCrear, reintentarCrearEnvio, type ColaMinima } from './jobs';

/** Cola falsa con estados por id (como BullMQ: `getJob` + `getState`, `remove`, `add`). */
function colaFalsa(inicial: Record<string, string> = {}) {
  const jobs = new Map<string, { estado: string; nombre: string; datos: unknown; opts: Record<string, unknown> }>(
    Object.entries(inicial).map(([id, estado]) => [id, { estado, nombre: JOB_CARRIER_CREATE, datos: null, opts: {} }]),
  );
  const cola: ColaMinima = {
    async getJob(id) {
      const j = jobs.get(id);
      if (!j) return undefined;
      return { getState: async () => j.estado, remove: async () => void jobs.delete(id) };
    },
    async add(nombre, datos, opts) {
      jobs.set(String(opts.jobId), { estado: 'waiting', nombre, datos, opts });
      return null;
    },
  };
  return { cola, jobs };
}

const PEDIDO = '7f3c2a10-1111-4222-8333-944455556666';

describe('reintentarCrearEnvio (botón "Reintentar")', () => {
  it('desde error_transportadora reinicia la serie con intento 0 y el id base', async () => {
    const { cola, jobs } = colaFalsa({ [jobIdCrear(PEDIDO)]: 'completed', [jobIdCrear(PEDIDO, 5)]: 'failed' });
    expect(await reintentarCrearEnvio(cola, PEDIDO, 'error_transportadora')).toBe('encolado');
    const j = jobs.get(`carrier.create.${PEDIDO}`)!;
    expect(j).toMatchObject({ estado: 'waiting', nombre: 'carrier.create', datos: { order_id: PEDIDO, intento: 0 } });
    expect(j.opts).toMatchObject({ jobId: `carrier.create.${PEDIDO}`, attempts: 4 });
  });

  it('doble clic: el segundo ve el job pendiente y no encola otro', async () => {
    const { cola, jobs } = colaFalsa();
    expect(await reintentarCrearEnvio(cola, PEDIDO, 'error_transportadora')).toBe('encolado');
    expect(await reintentarCrearEnvio(cola, PEDIDO, 'error_transportadora')).toBe('ya_pendiente');
    expect(jobs.size).toBe(1);
  });

  it('con un reintento automático .r{n} programado no adelanta otro', async () => {
    const { cola, jobs } = colaFalsa({ [`carrier.create.${PEDIDO}.r3`]: 'delayed' });
    expect(await reintentarCrearEnvio(cola, PEDIDO, 'pagado')).toBe('ya_pendiente');
    expect(jobs.size).toBe(1);
  });

  it('fuera de fase (ya enviado, cancelado…) no encola', async () => {
    const { cola, jobs } = colaFalsa();
    for (const e of ['enviado_transportadora', 'cancelado', 'en_transito', 'pendiente_pago']) {
      expect(await reintentarCrearEnvio(cola, PEDIDO, e)).toBe('estado_invalido');
    }
    expect(jobs.size).toBe(0);
  });

  it('id de pedido inválido para BullMQ → lanza antes de tocar la cola', async () => {
    const { cola } = colaFalsa();
    await expect(reintentarCrearEnvio(cola, 'a:b', 'pagado')).rejects.toThrow(/orderId/);
  });
});
