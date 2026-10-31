import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { registrarCron } from './cron.js';

describe('registrarCron', () => {
  it('programa la purga diaria del audit_log a las 03:30 de Bogotá', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await registrarCron({ upsertJobScheduler } as unknown as Queue);
    const llamadas = upsertJobScheduler.mock.calls as [string, { pattern: string; tz: string }, { name: string }][];
    const purga = llamadas.find(([id]) => id === 'purgar-audit-log');
    expect(purga).toBeDefined();
    expect(purga?.[1]).toEqual({ pattern: '30 3 * * *', tz: 'America/Bogota' });
    expect(purga?.[2].name).toBe('purgar-audit-log');
  });
});

describe('registrarCron barrido', () => {
  it('programa pedidos.barrido cada 5 minutos', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await registrarCron({ upsertJobScheduler } as unknown as Queue);
    const llamadas = upsertJobScheduler.mock.calls as [string, { pattern: string; tz: string }, { name: string }][];
    const b = llamadas.find(([id]) => id === 'pedidos.barrido');
    expect(b?.[1]).toEqual({ pattern: '*/5 * * * *', tz: 'America/Bogota' });
    expect(b?.[2].name).toBe('pedidos.barrido');
  });
});

describe('registrarCron MasterShop', () => {
  it('programa polling cada 10 min y billetera al minuto 7 de cada hora, en Bogotá', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await registrarCron({ upsertJobScheduler } as unknown as Queue);
    const llamadas = upsertJobScheduler.mock.calls as [string, { pattern: string; tz: string }, { name: string }][];
    const p = llamadas.find(([id]) => id === 'mastershop.polling');
    const b = llamadas.find(([id]) => id === 'mastershop.billetera');
    expect(p?.[1]).toEqual({ pattern: '*/10 * * * *', tz: 'America/Bogota' });
    expect(b?.[1]).toEqual({ pattern: '7 * * * *', tz: 'America/Bogota' });
    expect(p?.[2].name).toBe('mastershop.polling');
    expect(b?.[2].name).toBe('mastershop.billetera');
  });
});

describe('registrarCron métricas', () => {
  it('programa metrics.recompute_recent a las 03:30 de Bogotá', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await registrarCron({ upsertJobScheduler } as unknown as Queue);
    const llamadas = upsertJobScheduler.mock.calls as [string, { pattern: string; tz: string }, { name: string }][];
    const m = llamadas.find(([id]) => id === 'metrics.recompute_recent');
    expect(m?.[1]).toEqual({ pattern: '30 3 * * *', tz: 'America/Bogota' });
    expect(m?.[2].name).toBe('metrics.recompute_recent');
  });
});

describe('registrarCron media', () => {
  it('programa media.borrar_archivos cada 15 min', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await registrarCron({ upsertJobScheduler } as unknown as Queue);
    const llamadas = upsertJobScheduler.mock.calls as [string, { pattern: string }, { name: string }][];
    expect(llamadas.find(([id]) => id === 'media.borrar_archivos')?.[1].pattern).toBe('*/15 * * * *');
  });
});

describe('registrarCron chat', () => {
  it('programa chat.purgar_conversaciones de madrugada en Bogotá', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await registrarCron({ upsertJobScheduler } as unknown as Queue);
    const llamadas = upsertJobScheduler.mock.calls as [string, { pattern: string; tz: string }, unknown][];
    expect(llamadas.find(([id]) => id === 'chat.purgar_conversaciones')?.[1]).toEqual({ pattern: '45 3 * * *', tz: 'America/Bogota' });
  });
});
