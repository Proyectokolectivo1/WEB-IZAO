import { describe, expect, it } from 'vitest';
import { evaluarIntento, netosDe } from './bloqueo';

describe('evaluarIntento (el bloqueo falla cerrado)', () => {
  it('registra el intento ANTES de contar', async () => {
    const orden: string[] = [];
    const r = await evaluarIntento({
      registrar: async () => {
        orden.push('registrar');
        return true;
      },
      contadores: [
        {
          max: 5,
          netos: async () => {
            orden.push('contar');
            return 1;
          },
        },
      ],
    });
    expect(r).toBe('permitido');
    expect(orden).toEqual(['registrar', 'contar']);
  });

  it('si no se puede registrar el intento, no deja pasar', async () => {
    let contado = false;
    const r = await evaluarIntento({
      registrar: async () => false,
      contadores: [{ max: 5, netos: async () => ((contado = true), 0) }],
    });
    expect(r).toBe('error');
    expect(contado).toBe(false);
  });

  it('si falla la consulta de un contador (null), no deja pasar', async () => {
    const r = await evaluarIntento({
      registrar: async () => true,
      contadores: [
        { max: 5, netos: async () => 0 },
        { max: 15, netos: async () => null },
      ],
    });
    expect(r).toBe('error');
  });

  it('si un contador lanza una excepción, no deja pasar', async () => {
    const r = await evaluarIntento({
      registrar: async () => true,
      contadores: [
        {
          max: 5,
          netos: async () => {
            throw new Error('red caída');
          },
        },
      ],
    });
    expect(r).toBe('error');
  });

  it('si registrar lanza una excepción, no deja pasar', async () => {
    const r = await evaluarIntento({
      registrar: async () => {
        throw new Error('boom');
      },
      contadores: [],
    });
    expect(r).toBe('error');
  });

  it('permite hasta el máximo (el intento actual ya cuenta) y bloquea el siguiente', async () => {
    const con = (n: number) => ({ registrar: async () => true, contadores: [{ max: 5, netos: async () => n }] });
    expect(await evaluarIntento(con(5))).toBe('permitido');
    expect(await evaluarIntento(con(6))).toBe('bloqueado');
  });

  it('bloquea si cualquiera de los contadores se pasa', async () => {
    const r = await evaluarIntento({
      registrar: async () => true,
      contadores: [
        { max: 5, netos: async () => 2 },
        { max: 15, netos: async () => 16 },
      ],
    });
    expect(r).toBe('bloqueado');
  });

  it('intentos en paralelo: cada uno ve a los demás porque todos registran antes de contar', async () => {
    let registrados = 0;
    const lanzar = () =>
      evaluarIntento({
        registrar: async () => {
          registrados += 1;
          await Promise.resolve();
          return true;
        },
        contadores: [{ max: 5, netos: async () => registrados }],
      });
    const resultados = await Promise.all(Array.from({ length: 10 }, lanzar));
    expect(resultados.every((x) => x === 'bloqueado')).toBe(true);
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
