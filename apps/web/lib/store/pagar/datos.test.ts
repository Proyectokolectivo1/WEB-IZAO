import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  fila: null as Record<string, unknown> | null,
  clic: null as unknown,
  falla: false,
  clics: [] as string[],
}));

vi.mock('../checkout-datos', () => ({ usarSupabase: () => true }));
vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: estado.fila, error: null }) }) }) }),
  }),
}));
vi.mock('@/lib/db/pay-links', () => ({
  registrarClicPayLinkDb: async (token: string) => {
    estado.clics.push(token);
    if (estado.falla) throw new Error('base caída');
    return estado.clic;
  },
}));

import { abrirEnlacePago } from './datos';

const TOKEN = 'A1b2C3d4E5f6G7h8I9j0Kl';
const URL_OK = 'https://checkout.wompi.co/l/abc123';
const ORDEN = '3f2b8c1e-5d4a-4b6f-9c7d-1e2f3a4b5c6d';

const clic = (estadoLink: string, extra: Record<string, unknown> = {}) => ({
  ok: true,
  estado: estadoLink,
  order_id: ORDEN,
  order_number: 'IZ-CO-000123',
  clicks: 5,
  expires_at: '2026-10-21T00:00:00Z',
  ...(estadoLink === 'vigente' ? { target_url: URL_OK } : {}),
  ...extra,
});

beforeEach(() => {
  estado.fila = { orders: { country_code: 'CO' } };
  estado.clic = clic('vigente');
  estado.falla = false;
  estado.clics = [];
});

describe('abrirEnlacePago', () => {
  it('token mal formado: no existe, sin tocar la base', async () => {
    expect(await abrirEnlacePago('co', 'corto')).toEqual({ tipo: 'no_existe' });
    expect(estado.clics).toHaveLength(0);
  });

  it('token inexistente: no existe y no cuenta clic', async () => {
    estado.fila = null;
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'no_existe' });
    expect(estado.clics).toHaveLength(0);
  });

  it('link de otro país: no existe y no cuenta clic', async () => {
    estado.fila = { orders: { country_code: 'EC' } };
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'no_existe' });
    expect(estado.clics).toHaveLength(0);
  });

  it('vigente: cuenta el clic con pay_link_click y redirige al target_url', async () => {
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'redirigir', url: URL_OK });
    expect(estado.clics).toEqual([TOKEN]);
  });

  it('vigente pero el destino no es https: se muestra vencido', async () => {
    estado.clic = clic('vigente', { target_url: 'http://checkout.wompi.co/l/x' });
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'vencido', numero: 'IZ-CO-000123' });
  });

  it('la base manda: pagado y vencido no redirigen', async () => {
    estado.clic = clic('pagado');
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'pagado', numero: 'IZ-CO-000123' });
    estado.clic = clic('vencido');
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'vencido', numero: 'IZ-CO-000123' });
  });

  it('la función responde que el token no existe: 404', async () => {
    estado.clic = { ok: false, motivo: 'no_existe' };
    expect(await abrirEnlacePago('co', TOKEN)).toEqual({ tipo: 'no_existe' });
  });

  it('si la base falla no se redirige a ciegas: la excepción sube a la página de error', async () => {
    estado.falla = true;
    await expect(abrirEnlacePago('co', TOKEN)).rejects.toThrow('base caída');
  });
});
