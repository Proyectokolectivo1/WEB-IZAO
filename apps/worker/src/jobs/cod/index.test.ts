import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearProcesadorCod, dependenciasCodDesdeEnv } from './index.js';

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
