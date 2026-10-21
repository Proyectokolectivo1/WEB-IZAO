import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';
import { activarCredencialIntegracionDb } from './credenciales-integracion';

const ID = 'c0000000-0000-0000-0000-0000000028a2';
const ANT = 'c0000000-0000-0000-0000-0000000028a1';
const base = { ok: true, id: ID, provider: 'wompi', country_code: 'CO', environment: 'production' };

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('activarCredencialIntegracionDb', () => {
  it('activada: llama el RPC con el id e informa la anterior', async () => {
    const rpc = clienteFalso({ ...base, estado: 'activada', anterior_id: ANT, anterior_environment: 'sandbox' });
    const r = await activarCredencialIntegracionDb(ID);
    expect(rpc).toHaveBeenCalledWith('activar_credencial_integracion', { p_id: ID });
    expect(r).toMatchObject({ ok: true, estado: 'activada', anterior_environment: 'sandbox' });
  });

  it('activada sin anterior, global (country null) y ya_activa pasan tal cual', async () => {
    clienteFalso({ ...base, country_code: null, estado: 'activada', anterior_id: null, anterior_environment: null });
    expect(await activarCredencialIntegracionDb(ID)).toMatchObject({ estado: 'activada', country_code: null });
    clienteFalso({ ...base, estado: 'ya_activa' });
    expect(await activarCredencialIntegracionDb(ID)).toMatchObject({ estado: 'ya_activa' });
    clienteFalso({ ok: false, motivo: 'no_existe' });
    expect(await activarCredencialIntegracionDb(ID)).toEqual({ ok: false, motivo: 'no_existe' });
  });

  it('id que no es UUID: datos_invalidos sin llamar la base', async () => {
    const rpc = clienteFalso(null);
    expect(await activarCredencialIntegracionDb('x')).toEqual({ ok: false, motivo: 'datos_invalidos' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('respuesta con forma inesperada o error de la base: ErrorDb', async () => {
    clienteFalso({ ok: true, estado: 'activada', id: ID });
    await expect(activarCredencialIntegracionDb(ID)).rejects.toBeInstanceOf(ErrorDb);
    clienteFalso(null, { message: 'permission denied', code: '42501' });
    await expect(activarCredencialIntegracionDb(ID)).rejects.toMatchObject({ motivo: 'rpc', codigo: '42501' });
  });
});
