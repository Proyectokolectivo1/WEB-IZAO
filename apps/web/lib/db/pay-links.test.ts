import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { registrarClicPayLinkDb } from './pay-links';

const ID = 'd3000000-0000-0000-0000-000000000001';
const BASE = { ok: true, order_id: ID, order_number: 'CO-1001', clicks: 3, expires_at: '2026-10-21T15:00:00+00:00' };

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('registrarClicPayLinkDb', () => {
  it('vigente: llama el RPC con el token y devuelve target_url', async () => {
    const rpc = clienteFalso({ ...BASE, estado: 'vigente', target_url: 'https://checkout.wompi.co/l/abc' });
    const r = await registrarClicPayLinkDb('tokenAbc_123');
    expect(rpc).toHaveBeenCalledWith('pay_link_click', { p_token: 'tokenAbc_123' });
    expect(r).toMatchObject({ ok: true, estado: 'vigente', target_url: 'https://checkout.wompi.co/l/abc', clicks: 3 });
  });

  it('pagado y vencido: sin target_url', async () => {
    clienteFalso({ ...BASE, estado: 'pagado' });
    expect(await registrarClicPayLinkDb('tokenAbc_123')).toMatchObject({ ok: true, estado: 'pagado' });
    clienteFalso({ ...BASE, estado: 'vencido' });
    const r = await registrarClicPayLinkDb('tokenAbc_123');
    expect(r).toMatchObject({ ok: true, estado: 'vencido' });
    expect(r).not.toHaveProperty('target_url');
  });

  it('no_existe pasa tal cual', async () => {
    clienteFalso({ ok: false, motivo: 'no_existe' });
    expect(await registrarClicPayLinkDb('tokenAbc_123')).toEqual({ ok: false, motivo: 'no_existe' });
  });

  it('token mal formado: datos_invalidos sin llamar la base', async () => {
    const rpc = clienteFalso(null);
    expect(await registrarClicPayLinkDb('a b')).toEqual({ ok: false, motivo: 'datos_invalidos' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('vigente sin target_url: ErrorDb de forma', async () => {
    clienteFalso({ ...BASE, estado: 'vigente' });
    await expect(registrarClicPayLinkDb('tokenAbc_123')).rejects.toBeInstanceOf(ErrorDb);
  });

  it('error de la base: ErrorDb rpc con código', async () => {
    clienteFalso(null, { message: 'permission denied', code: '42501' });
    await expect(registrarClicPayLinkDb('tokenAbc_123')).rejects.toMatchObject({ motivo: 'rpc', codigo: '42501' });
  });
});
