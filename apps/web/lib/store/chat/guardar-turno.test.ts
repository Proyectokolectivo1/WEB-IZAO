import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/supabase/servicio', () => ({
  crearClienteServicio: () => {
    throw new Error('las pruebas inyectan el cliente');
  },
}));

import { fijarClienteDbParaPruebas } from '@/lib/db/cliente';
import { guardarTurno } from './fuente-supabase';
import type { ResultadoTurno } from './conversar';

const SESION = { id: 'c4a70000-0000-4000-8000-000000000001', mensajes: 2 };
const AHORA = new Date('2026-11-02T15:00:00.000Z');

function cliente(data: unknown = 3) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const tabla = vi.fn(() => {
    throw new Error('guardarTurno ya no debe tocar las tablas: usa solo la RPC');
  });
  fijarClienteDbParaPruebas({ rpc, from: tabla } as never);
  return { rpc, tabla };
}

const resultado = (parcial: Partial<ResultadoTurno> = {}): ResultadoTurno =>
  ({ texto: 'Con gusto te ayudo.', herramientas: [], modelo: 'modelo/x', tokensIn: 120, tokensOut: 40, costoMicros: 4_500n, ...parcial }) as ResultadoTurno;

afterEach(() => fijarClienteDbParaPruebas(null));

describe('guardarTurno', () => {
  it('una sola llamada a la RPC con pregunta y respuesta, y devuelve el contador nuevo', async () => {
    const { rpc, tabla } = cliente(3);
    const n = await guardarTurno(SESION, 'Busco algo dulce', resultado(), AHORA);
    expect(n).toBe(3);
    expect(tabla).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nombre, args] = rpc.mock.calls[0] as [string, { p_session_id: string; p_mensajes: Record<string, unknown>[]; p_ahora: string }];
    expect(nombre).toBe('chat_registrar_turno');
    expect(args.p_session_id).toBe(SESION.id);
    expect(args.p_ahora).toBe(AHORA.toISOString());
    expect(args.p_mensajes).toEqual([
      { role: 'user', content: 'Busco algo dulce' },
      { role: 'assistant', content: 'Con gusto te ayudo.', tool_calls: null, model: 'modelo/x', tokens_in: 120, tokens_out: 40, cost_usd_micros: '4500' },
    ]);
  });

  it('si el modelo no respondió (turno cortado) guarda solo la pregunta', async () => {
    const { rpc } = cliente(1);
    await guardarTurno(SESION, 'Hola', null, AHORA);
    await guardarTurno(SESION, 'Hola', resultado({ texto: '', herramientas: [] }), AHORA);
    for (const llamada of rpc.mock.calls) expect((llamada[1] as { p_mensajes: unknown[] }).p_mensajes).toEqual([{ role: 'user', content: 'Hola' }]);
  });

  it('con solo llamadas a herramientas guarda la respuesta sin texto', async () => {
    const { rpc } = cliente(2);
    const herramientas = [{ nombre: 'buscar_productos', argumentos: '{}' }];
    await guardarTurno(SESION, 'Algo fresco', resultado({ texto: '', herramientas }), AHORA);
    const msgs = (rpc.mock.calls[0]?.[1] as { p_mensajes: Record<string, unknown>[] }).p_mensajes;
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: null, tool_calls: herramientas });
  });
});
