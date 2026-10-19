import { describe, expect, it } from 'vitest';
import { evaluarIntento, netosDe, registrarUnaVez } from './bloqueo';

const c = (netos: () => Promise<number | null>, max = 5, clave = 'correo') => ({ netos, max, clave });

describe('evaluarIntento (el bloqueo falla cerrado)', () => {
  it('cuenta, registra el intento y vuelve a contar (el conteo final ya lo incluye)', async () => {
    const orden: string[] = [];
    const r = await evaluarIntento({
      registrar: async () => {
        orden.push('registrar');
        return true;
      },
      contadores: [
        c(async () => {
          orden.push('contar');
          return 1;
        }),
      ],
    });
    expect(r.estado).toBe('permitido');
    expect(orden).toEqual(['contar', 'registrar', 'contar']);
  });

  it('si ya está bloqueado NO registra otro intento (no llena audit_log)', async () => {
    let registrado = false;
    const r = await evaluarIntento({
      registrar: async () => ((registrado = true), true),
      contadores: [c(async () => 5, 5, 'correo')],
    });
    expect(r).toEqual({ estado: 'bloqueado', por: 'correo' });
    expect(registrado).toBe(false);
  });

  it('indica por cuál contador se bloqueó', async () => {
    const r = await evaluarIntento({
      registrar: async () => true,
      contadores: [c(async () => 1, 5, 'correo'), c(async () => 15, 15, 'ip')],
    });
    expect(r).toEqual({ estado: 'bloqueado', por: 'ip' });
  });

  it('si falla la consulta inicial (null), no deja pasar ni registra', async () => {
    let registrado = false;
    const r = await evaluarIntento({
      registrar: async () => ((registrado = true), true),
      contadores: [c(async () => null)],
    });
    expect(r.estado).toBe('error');
    expect(registrado).toBe(false);
  });

  it('si no se puede registrar el intento, no deja pasar', async () => {
    const r = await evaluarIntento({ registrar: async () => false, contadores: [c(async () => 0)] });
    expect(r.estado).toBe('error');
  });

  it('si falla el conteo posterior al registro, no deja pasar', async () => {
    let llamadas = 0;
    const r = await evaluarIntento({
      registrar: async () => true,
      contadores: [c(async () => (++llamadas === 1 ? 0 : null))],
    });
    expect(r.estado).toBe('error');
  });

  it('si algo lanza una excepción, no deja pasar', async () => {
    const r = await evaluarIntento({
      registrar: async () => {
        throw new Error('boom');
      },
      contadores: [c(async () => 0)],
    });
    expect(r.estado).toBe('error');
  });

  it('permite hasta el máximo y bloquea el siguiente', async () => {
    // Antes de registrar hay 4 (cabe uno más); tras registrar hay 5 = máximo: permitido.
    let n = 4;
    const permitido = await evaluarIntento({
      registrar: async () => ((n += 1), true),
      contadores: [c(async () => n)],
    });
    expect(permitido.estado).toBe('permitido');
    // Con 5 ya contados, el siguiente se bloquea sin registrar.
    expect((await evaluarIntento({ registrar: async () => true, contadores: [c(async () => 5)] })).estado).toBe(
      'bloqueado',
    );
  });

  it('intentos en paralelo: tras registrar, cada uno ve a los demás', async () => {
    let registrados = 0;
    const lanzar = () =>
      evaluarIntento({
        registrar: async () => {
          registrados += 1;
          await Promise.resolve();
          return true;
        },
        contadores: [c(async () => registrados)],
      });
    const resultados = await Promise.all(Array.from({ length: 10 }, lanzar));
    expect(resultados.every((x) => x.estado === 'bloqueado')).toBe(true);
  });

  it('una ráfaga contra una clave ya bloqueada no inserta ninguna fila', async () => {
    let filas = 0;
    const lanzar = () =>
      evaluarIntento({
        registrar: async () => ((filas += 1), true),
        contadores: [c(async () => 6)],
      });
    await Promise.all(Array.from({ length: 200 }, lanzar));
    expect(filas).toBe(0);
  });
});

describe('registrarUnaVez (aviso de bloqueo, a lo sumo una vez por ventana)', () => {
  it('registra si aún no hay aviso en la ventana', async () => {
    let filas = 0;
    await registrarUnaVez({ contar: async () => 0, registrar: async () => ((filas += 1), true) });
    expect(filas).toBe(1);
  });

  it('no registra si ya hay un aviso', async () => {
    let filas = 0;
    await registrarUnaVez({ contar: async () => 1, registrar: async () => ((filas += 1), true) });
    expect(filas).toBe(0);
  });

  it('si no se puede contar, no registra (no llena la tabla)', async () => {
    let filas = 0;
    await registrarUnaVez({ contar: async () => null, registrar: async () => ((filas += 1), true) });
    expect(filas).toBe(0);
  });
});

describe('netosDe', () => {
  it('resta los éxitos a los intentos y nunca baja de 0', () => {
    expect(netosDe(6, 2)).toBe(4);
    expect(netosDe(1, 3)).toBe(0);
  });

  it('devuelve null si alguna cuenta falló', () => {
    expect(netosDe(null, 0)).toBeNull();
    expect(netosDe(3, null)).toBeNull();
  });
});
