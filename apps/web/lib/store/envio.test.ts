import { describe, expect, it } from 'vitest';
import { textosEnvio } from './envio';
import { T } from './textos';

describe('textosEnvio', () => {
  it('sin espacios usa los valores por defecto del seed', () => {
    expect(textosEnvio([])).toEqual({ nota: T.carrito.notaEnvio, valor: T.carrito.envioGratis });
  });

  it('toma la nota del cuerpo y el valor del título del panel', () => {
    const r = textosEnvio([
      { key: 'nota_envio', title: null, body: '  Envío desde $15.000.  ' },
      { key: 'valor_envio', title: 'Desde $15.000', body: null },
    ]);
    expect(r).toEqual({ nota: 'Envío desde $15.000.', valor: 'Desde $15.000' });
  });

  it('un campo vacío vuelve al valor por defecto', () => {
    const r = textosEnvio([
      { key: 'nota_envio', title: null, body: '   ' },
      { key: 'valor_envio', title: '', body: null },
    ]);
    expect(r.nota).toBe(T.carrito.notaEnvio);
    expect(r.valor).toBe(T.carrito.envioGratis);
  });
});
