import { describe, expect, it } from 'vitest';
import { JOB_CARRIER_SYNC } from '@izao/mastershop';
import {
  CRON_BILLETERA_MASTERSHOP,
  CRON_POLLING_MASTERSHOP,
  JOB_BILLETERA_MASTERSHOP,
  JOB_POLLING_MASTERSHOP,
  dependenciasBilleteraDesdeEnv,
  dependenciasPollingDesdeEnv,
} from './index.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k', APP_ENCRYPTION_KEY: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=' };

describe('cableado de jobs/sync', () => {
  it('nombres y cron del contrato con izao-infra', () => {
    expect(JOB_POLLING_MASTERSHOP).toBe('mastershop.polling');
    expect(CRON_POLLING_MASTERSHOP).toBe('*/10 * * * *');
    expect(JOB_BILLETERA_MASTERSHOP).toBe('mastershop.billetera');
    expect(CRON_BILLETERA_MASTERSHOP).toBe('7 * * * *');
  });

  it('faltan variables → error claro', () => {
    expect(() => dependenciasPollingDesdeEnv({ getJob: async () => null, add: async () => null }, {})).toThrow(/SUPABASE_URL/);
    expect(() => dependenciasBilleteraDesdeEnv({})).toThrow(/SUPABASE_URL/);
  });

  it('modo simulado: sin credenciales, no sale a la API real', async () => {
    const p = dependenciasPollingDesdeEnv({ getJob: async () => null, add: async () => null }, { ...ENV, MASTERSHOP_MODO: 'simulado' });
    expect(await p.fuente.credenciales()).toBeNull();
    expect(await dependenciasBilleteraDesdeEnv({ ...ENV, MASTERSHOP_MODO: 'simulado' }).fuente.credenciales()).toBeNull();
  });

  it('encolarSync usa la cola carrier con el nombre carrier.sync e id fijo', async () => {
    const agregados: { nombre: string; opts: Record<string, unknown> }[] = [];
    const p = dependenciasPollingDesdeEnv({ getJob: async () => null, add: async (nombre, _d, opts) => agregados.push({ nombre, opts }) }, ENV);
    await p.encolarSync({ event_id: null, provider_order_id: 1001, external_order_id: 'IZ-CO-000001', origen: 'polling' }, 'carrier.sync.polling.1001');
    expect(agregados[0]).toMatchObject({ nombre: JOB_CARRIER_SYNC, opts: { jobId: 'carrier.sync.polling.1001' } });
  });
});
