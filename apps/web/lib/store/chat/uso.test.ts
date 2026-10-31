import { describe, expect, it, vi } from 'vitest';
import { registrarUsoMes } from './uso';

describe('registrarUsoMes', () => {
  it('llama la RPC atómica con el costo en texto y devuelve el total del mes', async () => {
    const rpc = vi.fn(async () => ({ data: 12_345_678, error: null }));
    expect(await registrarUsoMes({ rpc }, 480_000n)).toBe(12_345_678n);
    expect(rpc).toHaveBeenCalledWith('chat_registrar_uso', { p_costo_micros: '480000', p_mensajes: 1 });
  });
  it('acepta un total como texto (bigint de PostgREST) y un costo cero', async () => {
    const rpc = vi.fn(async () => ({ data: '9007199254740993', error: null }));
    expect(await registrarUsoMes({ rpc }, 0n)).toBe(9_007_199_254_740_993n);
  });
  it('rechaza costos negativos sin llamar a la base y propaga los errores de la RPC', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'negativo', code: '22023' } }));
    await expect(registrarUsoMes({ rpc }, -1n)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    await expect(registrarUsoMes({ rpc }, 5n)).rejects.toThrow(/22023/);
  });
});
