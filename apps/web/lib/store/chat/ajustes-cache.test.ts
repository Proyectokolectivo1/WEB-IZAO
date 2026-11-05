import { afterEach, describe, expect, it, vi } from 'vitest';

// Imita lo que hace `unstable_cache` de Next: guarda el resultado con JSON.stringify (falla con bigint) y devuelve la copia leída.
const guardados: string[] = [];
vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const valor = await fn(...a);
      const json = JSON.stringify(valor);
      guardados.push(json);
      return JSON.parse(json) as R;
    },
}));
vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { fijarClienteDbParaPruebas } from '@/lib/db/cliente';
import { leerAjustesChat } from './fuente-supabase';

function conFila(data: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  fijarClienteDbParaPruebas({ from: () => ({ select: () => ({ maybeSingle }) }) } as never);
}

afterEach(() => {
  fijarClienteDbParaPruebas(null);
  guardados.length = 0;
});

describe('leerAjustesChat (caché de Next, valores serializables)', () => {
  it('con la fila del panel: cachea sin bigint y devuelve el presupuesto como bigint', async () => {
    conFila({ is_enabled: true, model_primary: 'modelo/x', monthly_budget_usd_micros: 12_500_000, degrade_at_pct: 70, welcome_message: { co: ' Hola ' } });
    const a = await leerAjustesChat();
    expect(typeof a.presupuestoMicros).toBe('bigint');
    expect(a.presupuestoMicros).toBe(12_500_000n);
    expect(a.habilitado).toBe(true);
    expect(a.degradarPct).toBe(70);
    expect(a.bienvenida).toEqual({ CO: 'Hola' });
    expect(guardados).toHaveLength(1);
  });

  it('sin fila (valores por defecto): también se puede cachear', async () => {
    conFila(null);
    const a = await leerAjustesChat();
    expect(a.presupuestoMicros).toBe(10_000_000n);
    expect(a.habilitado).toBe(false);
  });

  it('presupuesto grande como texto (bigint de Postgres) conserva todos los dígitos', async () => {
    conFila({ monthly_budget_usd_micros: '9007199254740993' });
    const a = await leerAjustesChat();
    expect(a.presupuestoMicros).toBe(9_007_199_254_740_993n);
  });
});
