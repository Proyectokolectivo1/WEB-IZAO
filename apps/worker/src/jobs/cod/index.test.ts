import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelayedError } from 'bullmq';
import { JOB_COD_AVISO_CANCELACION, jobIdCodAvisoCancelacion } from '@izao/whatsapp';
import { cancelarJobsCod, crearProcesadorCod, dependenciasCodDesdeEnv, programadorCod } from './index.js';

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SECRET_KEY: 'llave-de-servidor-ficticia',
  APP_ENCRYPTION_KEY: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  SITE_URL: 'https://izaoperfumeria.com',
};

describe('dependenciasCodDesdeEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('arma las dependencias con el programador recibido y SITE_URL', () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const programar = async () => {};
    const d = dependenciasCodDesdeEnv(programar);
    expect(d.programar).toBe(programar);
    expect(d.urlSitio).toBe('https://izaoperfumeria.com');
    expect(typeof d.fuente.pedido).toBe('function');
    expect(d.correoRespaldo).toBeUndefined();
  });

  it('acepta un correo de respaldo detrás de la interfaz (sin proveedor fijo)', () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const correo = async () => {};
    expect(dependenciasCodDesdeEnv(async () => {}, correo).correoRespaldo).toBe(correo);
  });

  it.each(Object.keys(ENV))('sin %s lanza sin mostrar valores', (falta) => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, k === falta ? '' : v);
    expect(() => dependenciasCodDesdeEnv(async () => {})).toThrow(/Faltan/);
  });
});

describe('procesador cod.reenviar', () => {
  it('rechaza datos sin solicitado_en ISO UTC válido', async () => {
    const p = crearProcesadorCod({} as never);
    const order_id = '00000000-0000-4000-8000-0000000000aa';
    for (const solicitado_en of [undefined, 'ayer', '2026-10-20 18:00', 12]) {
      expect(await p({ name: 'cod.reenviar', data: { order_id, solicitado_en } } as never)).toEqual({ ok: false, motivo: 'datos_invalidos' });
    }
  });
});

describe('aviso de cancelación en la cola contraentrega', () => {
  const ORDER = '00000000-0000-4000-8000-0000000000aa';

  it('programadorCod: job cod.aviso_cancelacion con id fijo por pedido y retraso hasta la hora pedida', async () => {
    const add = vi.fn(async () => undefined);
    const programar = programadorCod({ add } as never, () => 1_000);
    await programar({ tipo: 'aviso_cancelacion', order_id: ORDER, en: new Date(61_000) });
    expect(add).toHaveBeenCalledWith(
      'cod.aviso_cancelacion',
      { order_id: ORDER },
      expect.objectContaining({ jobId: `cod.aviso_cancelacion.${ORDER}`, delay: 60_000 }),
    );
    expect(jobIdCodAvisoCancelacion(ORDER)).toBe(`cod.aviso_cancelacion.${ORDER}`);
    expect(JOB_COD_AVISO_CANCELACION).toBe('cod.aviso_cancelacion');
  });

  it('el procesador reprograma moviendo el job en horario silencioso', async () => {
    const noche = new Date('2026-10-21T03:30:00.000Z');
    const deps = {
      ahora: () => noche,
      fuente: {
        pedido: async () => ({ id: ORDER, status: 'abandonado', payment_method: 'cod', country_code: 'CO', created_at: noche, stock_reserved_until: noche }),
        config: async () => ({ offsetsMinutos: [30, 300], silencio: { inicio: '21:00', fin: '07:00' }, zona: 'America/Bogota' }),
      },
    };
    const moveToDelayed = vi.fn(async () => undefined);
    const p = crearProcesadorCod(deps as never);
    await expect(p({ name: 'cod.aviso_cancelacion', data: { order_id: ORDER }, moveToDelayed } as never, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(new Date('2026-10-21T12:00:00.000Z').getTime(), 'tok');
  });

  it('cancelarJobsCod no quita el aviso de cancelación (debe salir aunque se cancelen recordatorios y abandono)', async () => {
    const remove = vi.fn(async () => 0);
    await cancelarJobsCod({ remove } as never, ORDER);
    expect(remove).not.toHaveBeenCalledWith(`cod.aviso_cancelacion.${ORDER}`);
  });
});
