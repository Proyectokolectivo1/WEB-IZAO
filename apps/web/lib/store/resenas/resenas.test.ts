import { describe, expect, it, vi } from 'vitest';
import { afirmaOriginalidad } from '@/lib/admin/pagos/ajustes';
import { esquemaResena, nombreCorto, problemaFotosResena, MAX_BYTES_FOTO_RESENA } from './logica';
import { procesarResena, VENTANA_REENVIO_RESENA_MS, type EntradaResena, type FuenteResenas, type PedidoResena } from './proceso';
import { TR } from './textos';

const PRODUCTO = '3f2b8c1e-7d4a-4c1b-9e55-0a1b2c3d4e5f';

describe('nombreCorto', () => {
  it('deja el nombre y la inicial del apellido', () => {
    expect(nombreCorto('andrea pérez gómez')).toBe('Andrea P.');
    expect(nombreCorto('  Luis   ')).toBe('Luis');
    expect(nombreCorto('ÉRIKA ñáñez')).toBe('ÉRIKA Ñ.');
  });
});

describe('esquemaResena', () => {
  const base = { producto: PRODUCTO, nombre: 'Andrea Pérez', ciudad: '', estrellas: '5', texto: 'Dura todo el día y huele delicioso.', pedido: '', celular: '' };
  const campos = (v: object) => {
    const r = esquemaResena('CO').safeParse({ ...base, ...v });
    return r.success ? [] : r.error.issues.map((i) => i.path[0]);
  };

  it('acepta una reseña sin verificación y normaliza vacíos a null', () => {
    const r = esquemaResena('CO').parse(base);
    expect(r).toMatchObject({ estrellas: 5, ciudad: null, pedido: null, celular: null });
  });
  it('normaliza pedido y celular cuando vienen los dos', () => {
    const r = esquemaResena('CO').parse({ ...base, pedido: 'iz-co-000123', celular: '3101234567' });
    expect(r).toMatchObject({ pedido: 'IZ-CO-000123', celular: '+573101234567' });
  });
  it('pedido y celular van juntos; formatos inválidos se señalan', () => {
    expect(campos({ pedido: 'IZ-CO-000123' })).toEqual(['celular']);
    expect(campos({ celular: '3101234567' })).toEqual(['pedido']);
    expect(campos({ pedido: 'IZ-EC-000123', celular: '3101234567' })).toEqual(['pedido']);
    expect(campos({ pedido: 'IZ-CO-000123', celular: '12' })).toEqual(['celular']);
  });
  it('valida estrellas, nombre, texto y aroma', () => {
    expect(campos({ estrellas: '0' })).toEqual(['estrellas']);
    expect(campos({ estrellas: '6' })).toEqual(['estrellas']);
    expect(campos({ nombre: 'A' })).toEqual(['nombre']);
    expect(campos({ texto: 'corto' })).toEqual(['texto']);
    expect(campos({ producto: 'no-es-uuid' })).toEqual(['producto']);
  });
  it('tope de fotos y de tamaño', () => {
    expect(problemaFotosResena([{ tamano: 1 }, { tamano: 1 }, { tamano: 1 }])).toBeNull();
    expect(problemaFotosResena([{ tamano: 1 }, { tamano: 1 }, { tamano: 1 }, { tamano: 1 }])).toBe('muchas_fotos');
    expect(problemaFotosResena([{ tamano: MAX_BYTES_FOTO_RESENA + 1 }])).toBe('foto_pesada');
  });
});

const pedido: PedidoResena = { id: 'o1', celularE164: '+573101234567', entregado: true, incluyeProducto: true };
const entrada = (datos: Partial<EntradaResena['datos']> = {}, fotos: EntradaResena['fotos'] = []): EntradaResena => ({
  pais: 'CO',
  datos: {
    producto: PRODUCTO,
    nombre: 'Andrea Pérez',
    ciudad: 'Medellín',
    estrellas: 5,
    texto: 'Dura todo el día y huele delicioso.',
    pedido: null,
    celular: null,
    ...datos,
  },
  fotos,
  ahora: new Date('2026-10-20T12:00:00.000Z'),
});

function fuente(over: Partial<FuenteResenas> = {}): FuenteResenas {
  let n = 0;
  return {
    productoVisible: vi.fn(async () => true),
    pedidoPorNumero: vi.fn(async () => pedido),
    resenaReciente: vi.fn(async () => false),
    guardarFoto: vi.fn(async () => `foto-${++n}`),
    descartarMedia: vi.fn(async () => undefined),
    crear: vi.fn(async () => undefined),
    ...over,
  };
}
const foto = (nombre: string) => ({ buffer: Buffer.from(nombre), nombre });
const creada = (f: FuenteResenas) => vi.mocked(f.crear).mock.calls[0]?.[0];

describe('procesarResena', () => {
  it('entra siempre sin verificar si no se dio pedido, con nombre abreviado y fotos', async () => {
    const f = fuente();
    expect(await procesarResena(f, entrada({}, [foto('a.jpg'), foto('b.jpg')]))).toEqual({ ok: true });
    expect(creada(f)).toMatchObject({ autor: 'Andrea P.', ciudad: 'Medellín', estrellas: 5, verificada: false, pedidoId: null, mediaIds: ['foto-1', 'foto-2'] });
    expect(f.pedidoPorNumero).not.toHaveBeenCalled();
  });

  it('marca compra verificada con pedido entregado, celular que coincide y el aroma en el pedido', async () => {
    const f = fuente();
    await procesarResena(f, entrada({ pedido: 'IZ-CO-000123', celular: '+573101234567' }));
    expect(creada(f)).toMatchObject({ verificada: true, pedidoId: 'o1' });
  });

  it('si no coincide (inexistente, otro celular, sin entregar, otro aroma) la respuesta es idéntica y no se marca', async () => {
    const casos: (PedidoResena | null)[] = [null, { ...pedido, celularE164: '+573009998877' }, { ...pedido, entregado: false }, { ...pedido, incluyeProducto: false }];
    const exito = await procesarResena(fuente(), entrada());
    for (const p of casos) {
      const f = fuente({ pedidoPorNumero: async () => p });
      const r = await procesarResena(f, entrada({ pedido: 'IZ-CO-000123', celular: '+573101234567' }));
      expect(r).toEqual(exito);
      expect(creada(f)).toMatchObject({ verificada: false, pedidoId: null });
    }
  });

  it('rechaza un aroma que no existe o no es visible, sin guardar nada', async () => {
    const f = fuente({ productoVisible: async () => false });
    expect(await procesarResena(f, entrada({}, [foto('a.jpg')]))).toEqual({ ok: false, motivo: 'campos', campos: { producto: 'producto' } });
    expect(f.guardarFoto).not.toHaveBeenCalled();
  });

  it('un reenvío reciente no crea otra reseña', async () => {
    const f = fuente({ resenaReciente: vi.fn(async () => true) });
    expect(await procesarResena(f, entrada())).toEqual({ ok: true });
    expect(f.crear).not.toHaveBeenCalled();
    const desde = vi.mocked(f.resenaReciente).mock.calls[0]?.[3] as Date;
    expect(entrada().ahora.getTime() - desde.getTime()).toBe(VENTANA_REENVIO_RESENA_MS);
  });

  it('más de 3 fotos se rechaza antes de guardar', async () => {
    const f = fuente();
    const r = await procesarResena(f, entrada({}, [foto('1'), foto('2'), foto('3'), foto('4')]));
    expect(r).toEqual({ ok: false, motivo: 'campos', campos: { fotos: 'muchas_fotos' } });
    expect(f.guardarFoto).not.toHaveBeenCalled();
  });

  it('si falla el guardado o una foto es inválida, limpia lo ya subido', async () => {
    const f = fuente({
      crear: async () => {
        throw new Error('base caída');
      },
    });
    expect(await procesarResena(f, entrada({}, [foto('a.jpg')]))).toEqual({ ok: false, motivo: 'error' });
    expect(f.descartarMedia).toHaveBeenCalledWith(['foto-1']);

    let n = 0;
    const g = fuente({ guardarFoto: vi.fn(async () => (++n === 1 ? 'foto-1' : null)) });
    expect(await procesarResena(g, entrada({}, [foto('a.jpg'), foto('b.exe')]))).toEqual({ ok: false, motivo: 'campos', campos: { fotos: 'tipo' } });
    expect(g.descartarMedia).toHaveBeenCalledWith(['foto-1']);
    expect(g.crear).not.toHaveBeenCalled();
  });
});

describe('textos', () => {
  it('no afirman originalidad, autenticidad ni certificados (regla 7)', () => {
    const planos: string[] = [];
    const recorrer = (v: unknown) => {
      if (typeof v === 'string') planos.push(v);
      else if (typeof v === 'function') planos.push(String((v as (...a: unknown[]) => unknown)(1, 2)));
      else if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
    };
    recorrer(TR);
    expect(planos.length).toBeGreaterThan(30);
    for (const t of planos) expect(afirmaOriginalidad(t)).toBeFalsy();
  });
});
