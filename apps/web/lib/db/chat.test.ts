import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { registrarTurnoChatDb } from './chat';
import { ErrorDb, fijarClienteDbParaPruebas } from './cliente';

const SID = 'c4a70000-0000-4000-8000-000000000001';

function clienteFalso(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  fijarClienteDbParaPruebas({ rpc } as never);
  return rpc;
}

afterEach(() => fijarClienteDbParaPruebas(null));

describe('registrarTurnoChatDb', () => {
  it('envía la sesión, los mensajes (costo como texto) y la fecha, y devuelve el contador', async () => {
    const rpc = clienteFalso(3);
    const n = await registrarTurnoChatDb(
      SID,
      [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'Con gusto', model: 'm1', tokens_in: 10, tokens_out: 20, cost_usd_micros: 480000n },
      ],
      new Date('2026-11-02T12:00:00Z'),
    );
    expect(n).toBe(3);
    expect(rpc).toHaveBeenCalledWith('chat_registrar_turno', {
      p_session_id: SID,
      p_mensajes: [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'Con gusto', model: 'm1', tokens_in: 10, tokens_out: 20, cost_usd_micros: '480000' },
      ],
      p_ahora: '2026-11-02T12:00:00.000Z',
    });
  });

  it('sin fecha deja que la base use now()', async () => {
    const rpc = clienteFalso(1);
    await registrarTurnoChatDb(SID, [{ role: 'user', content: 'x' }]);
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_ahora');
  });

  it('sesión inexistente: ErrorDb con el código P0002', async () => {
    clienteFalso(null, { message: 'la sesión no existe', code: 'P0002' });
    await expect(registrarTurnoChatDb(SID, [{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      name: 'ErrorDb',
      codigo: 'P0002',
    });
  });

  it('respuesta con otra forma: ErrorDb de forma', async () => {
    clienteFalso('tres');
    await expect(registrarTurnoChatDb(SID, [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(ErrorDb);
  });
});
