import { describe, expect, it } from 'vitest';
import type { Job } from 'bullmq';
import { JOB_ADDI_CALLBACK } from '@izao/addi';
import { crearProcesadorPagos, type DepsPagos } from './index.js';

const job = (name: string, data: unknown) => ({ name, data }) as Job;
const CALLBACK = {
  orderId: 'IZ-CO-000123-A1',
  applicationId: 'app-1',
  approvedAmount: '0',
  currency: 'COP',
  status: 'PENDING',
  statusTimestamp: '1760972400',
};

function deps(conAddi: boolean): { d: DepsPagos; marcados: string[] } {
  const marcados: string[] = [];
  const addi = {
    fuente: {
      pagosPorReferencia: async () => [],
      marcarWebhook: async (id: string) => void marcados.push(id),
    },
    encolarTransportadora: async () => {},
  } as unknown as NonNullable<DepsPagos['addi']>;
  return { d: { ...(conAddi ? { addi } : {}) } as DepsPagos, marcados };
}

describe('procesador de la cola pagos: addi.callback', () => {
  it('sin dependencias de Addi lanza (BullMQ reintenta; el callback no se descarta)', async () => {
    const p = crearProcesadorPagos(deps(false).d);
    await expect(p(job(JOB_ADDI_CALLBACK, { event_id: 'e', callback: CALLBACK }))).rejects.toThrow(/dependencias de Addi/);
  });

  it('datos con forma inválida → datos_invalidos sin tocar la fuente', async () => {
    const { d, marcados } = deps(true);
    const p = crearProcesadorPagos(d);
    for (const data of [null, { event_id: 'e' }, { event_id: 'e', callback: { ...CALLBACK, status: 'OTRO' } }]) {
      expect(await p(job(JOB_ADDI_CALLBACK, data))).toEqual({ ok: false, motivo: 'datos_invalidos' });
    }
    expect(marcados).toEqual([]);
  });

  it('datos válidos → procesa el callback', async () => {
    const { d, marcados } = deps(true);
    const r = await crearProcesadorPagos(d)(job(JOB_ADDI_CALLBACK, { event_id: 'app-1.PENDING.1760972400', callback: CALLBACK }));
    expect(r).toEqual({ accion: 'pago_no_encontrado', order_id: null });
    expect(marcados).toEqual(['app-1.PENDING.1760972400']);
  });
});
