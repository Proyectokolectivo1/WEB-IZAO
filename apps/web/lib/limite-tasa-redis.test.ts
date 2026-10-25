import { describe, expect, it, vi } from 'vitest';
import { crearLimitadorRedis } from './limite-tasa-redis';

vi.mock('server-only', () => ({}));

describe('crearLimitadorRedis', () => {
  it('usa el conteo de Redis y permite hasta el límite', async () => {
    let n = 0;
    const cliente = { eval: vi.fn().mockImplementation(async () => [++n, 590_000]) };
    const l = crearLimitadorRedis({ prefijo: 'rl:garantia', limite: 5, ventanaMs: 600_000, cliente: () => cliente });
    const r = [];
    for (let i = 0; i < 6; i++) r.push(await l.consumir('1.2.3.4'));
    expect(r.map((x) => x.permitido)).toEqual([true, true, true, true, true, false]);
    expect(r[5]?.reintentarEnSeg).toBe(590);
    expect(cliente.eval.mock.calls[0]?.slice(1)).toEqual([1, 'rl:garantia:1.2.3.4', 600_000]);
  });

  it('si Redis falla, cae al límite en memoria (no abre ni rompe)', async () => {
    const cliente = { eval: vi.fn().mockRejectedValue(new Error('down')) };
    const l = crearLimitadorRedis({ prefijo: 'p', limite: 2, ventanaMs: 60_000, cliente: () => cliente });
    const r = [await l.consumir('a'), await l.consumir('a'), await l.consumir('a')];
    expect(r.map((x) => x.permitido)).toEqual([true, true, false]);
  });
});
