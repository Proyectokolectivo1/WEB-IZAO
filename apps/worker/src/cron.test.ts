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
