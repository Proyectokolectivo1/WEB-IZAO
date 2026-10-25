import { describe, expect, it, vi } from 'vitest';
import { afirmaOriginalidad } from '@/lib/admin/pagos/ajustes';
import {
  MAX_BYTES_FOTO,
  MAX_BYTES_VIDEO,
  detectarVideo,
  esquemaGarantia,
  estadoPlazo,
  fechaLimite,
  normalizarNumeroPedido,
  numeroPedidoValido,
  problemaAdjuntos,
} from './logica';
import { VENTANA_REENVIO_MS, procesarGarantia, type EntradaGarantia, type FuenteGarantias, type PedidoGarantia } from './proceso';
import { TG } from './textos';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(16)]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(8)]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypavif'), Buffer.alloc(16)]);

describe('número de pedido', () => {
  it('tolera minúsculas, espacios y guiones largos', () => {
    expect(normalizarNumeroPedido(' iz–co–000123 ')).toBe('IZ-CO-000123');
    expect(numeroPedidoValido(normalizarNumeroPedido('iz-co-000123'), 'CO')).toBe(true);
  });
  it('rechaza otro país o formato', () => {
    expect(numeroPedidoValido('IZ-EC-000123', 'CO')).toBe(false);
    expect(numeroPedidoValido('IZ-CO-12', 'CO')).toBe(false);
    expect(numeroPedidoValido('GAR-CO-0001', 'CO')).toBe(false);
  });
});

describe('plazo', () => {
  const entrega = '2026-10-01T15:00:00.000Z';
  it('vigente hasta period_days después de la entrega', () => {
    expect(fechaLimite(entrega, 30).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(estadoPlazo(entrega, 30, new Date('2026-10-31T14:59:00Z'))).toBe('vigente');
    expect(estadoPlazo(entrega, 30, new Date('2026-10-31T15:01:00Z'))).toBe('vencido');
  });
  it('sin fecha de entrega no hay plazo corriendo', () => {
    expect(estadoPlazo(null, 30, new Date())).toBe('sin_entrega');
  });
});

describe('adjuntos', () => {
  it('detecta video por contenido y no confunde AVIF con video', () => {
    expect(detectarVideo(MP4)).toBe('mp4');
    expect(detectarVideo(MOV)).toBe('mov');
    expect(detectarVideo(WEBM)).toBe('webm');
    expect(detectarVideo(AVIF)).toBeNull();
    expect(detectarVideo(Buffer.from('MZ-ejecutable'))).toBeNull();
  });
  it('hasta 5 fotos o 1 video, nunca mezclados, con tope de tamaño', () => {
    const f = (n: number, tamano = 1000) => Array.from({ length: n }, () => ({ tamano }));
    expect(problemaAdjuntos({ fotos: f(5), videos: [] })).toBeNull();
    expect(problemaAdjuntos({ fotos: f(6), videos: [] })).toBe('muchas_fotos');
    expect(problemaAdjuntos({ fotos: [], videos: f(2) })).toBe('muchos_videos');
    expect(problemaAdjuntos({ fotos: f(1), videos: f(1) })).toBe('mezcla');
    expect(problemaAdjuntos({ fotos: f(1, MAX_BYTES_FOTO + 1), videos: [] })).toBe('foto_pesada');
    expect(problemaAdjuntos({ fotos: [], videos: f(1, MAX_BYTES_VIDEO + 1) })).toBe('video_pesado');
    expect(problemaAdjuntos({ fotos: [], videos: f(1, MAX_BYTES_VIDEO) })).toBeNull();
  });
});

describe('esquemaGarantia', () => {
  const motivos = ['El producto llegó dañado', 'Otro'];
  const base = { pedido: 'iz-co-000123', celular: '3101234567', motivo: 'Otro', descripcion: 'Llegó con la tapa rota.' };
  it('normaliza pedido y celular (E.164)', () => {
    const r = esquemaGarantia('CO', motivos).parse(base);
    expect(r.pedido).toBe('IZ-CO-000123');
    expect(r.celular).toBe('+573101234567');
  });
  it('señala el campo que falla', () => {
    const campos = (v: object) => {
      const r = esquemaGarantia('CO', motivos).safeParse({ ...base, ...v });
      return r.success ? [] : r.error.issues.map((i) => i.path[0]);
    };
    expect(campos({ pedido: 'x' })).toEqual(['pedido']);
    expect(campos({ celular: '123' })).toEqual(['celular']);
    expect(campos({ motivo: 'inventado' })).toEqual(['motivo']);
    expect(campos({ descripcion: 'corto' })).toEqual(['descripcion']);
  });
});

const pedido: PedidoGarantia = {
  id: 'p1',
  numero: 'IZ-CO-000123',
  celularE164: '+573101234567',
  nombre: 'Ana Pérez',
  correo: null,
  entregadoEn: '2026-10-10T12:00:00.000Z',
};
const entrada = (extra: Partial<EntradaGarantia> = {}): EntradaGarantia => ({
  pais: 'CO',
  datos: { pedido: 'IZ-CO-000123', celular: '+573101234567', motivo: 'Otro', descripcion: 'Llegó con la tapa rota.' },
  fotos: [],
  video: null,
  ajustes: { diasPlazo: 30, diasRespuesta: 5 },
  ahora: new Date('2026-10-20T12:00:00.000Z'),
  ...extra,
});

function fuente(over: Partial<FuenteGarantias> = {}): FuenteGarantias {
  let n = 0;
  return {
    pedidoPorNumero: vi.fn(async () => pedido),
    casoReciente: vi.fn(async () => null),
    guardarFoto: vi.fn(async () => `foto-${++n}`),
    guardarVideo: vi.fn(async () => 'video-1'),
    descartarMedia: vi.fn(async () => undefined),
    crearCaso: vi.fn(async () => ({ numero: 'GAR-CO-0001' })),
    ...over,
  };
}
const foto = (nombre: string) => ({ buffer: Buffer.from(nombre), nombre });

describe('procesarGarantia', () => {
  it('crea el caso con las fotos guardadas', async () => {
    const f = fuente();
    const r = await procesarGarantia(f, entrada({ fotos: [foto('a.jpg'), foto('b.jpg')] }));
    expect(r).toEqual({ ok: true, numero: 'GAR-CO-0001', diasRespuesta: 5, repetido: false });
    expect(vi.mocked(f.crearCaso).mock.calls[0]?.[0]).toMatchObject({
      pedidoId: 'p1',
      nombre: 'Ana Pérez',
      celularE164: '+573101234567',
      mediaIds: ['foto-1', 'foto-2'],
    });
  });

  it('pedido inexistente y celular distinto dan la misma respuesta', async () => {
    const sinPedido = await procesarGarantia(fuente({ pedidoPorNumero: async () => null }), entrada());
    const otroCelular = await procesarGarantia(fuente(), entrada({ datos: { ...entrada().datos, celular: '+573009998877' } }));
    expect(sinPedido).toEqual({ ok: false, motivo: 'pedido_no_encontrado' });
    expect(otroCelular).toEqual(sinPedido);
  });

  it('exige entrega y plazo vigente, y no guarda nada si no procede', async () => {
    const f = fuente({ pedidoPorNumero: async () => ({ ...pedido, entregadoEn: null }) });
    expect(await procesarGarantia(f, entrada())).toEqual({ ok: false, motivo: 'sin_entrega' });
    const g = fuente({ pedidoPorNumero: async () => ({ ...pedido, entregadoEn: '2026-08-01T00:00:00.000Z' }) });
    expect(await procesarGarantia(g, entrada({ fotos: [foto('a.jpg')] }))).toEqual({ ok: false, motivo: 'vencido' });
    expect(g.guardarFoto).not.toHaveBeenCalled();
    expect(g.crearCaso).not.toHaveBeenCalled();
  });

  it('un reenvío reciente devuelve el mismo caso sin crear otro', async () => {
    const f = fuente({ casoReciente: vi.fn(async () => 'GAR-CO-0007') });
    const r = await procesarGarantia(f, entrada());
    expect(r).toEqual({ ok: true, numero: 'GAR-CO-0007', diasRespuesta: 5, repetido: true });
    expect(f.crearCaso).not.toHaveBeenCalled();
    const desde = vi.mocked(f.casoReciente).mock.calls[0]?.[2] as Date;
    expect(entrada().ahora.getTime() - desde.getTime()).toBe(VENTANA_REENVIO_MS);
  });

  it('si el caso falla, limpia los archivos ya guardados', async () => {
    const f = fuente({
      crearCaso: async () => {
        throw new Error('base caída');
      },
    });
    const r = await procesarGarantia(f, entrada({ fotos: [foto('a.jpg')] }));
    expect(r).toEqual({ ok: false, motivo: 'error' });
    expect(f.descartarMedia).toHaveBeenCalledWith(['foto-1']);
  });

  it('una foto que no es imagen limpia lo anterior y se informa como tipo', async () => {
    let n = 0;
    const f = fuente({ guardarFoto: vi.fn(async () => (++n === 1 ? 'foto-1' : null)) });
    const r = await procesarGarantia(f, entrada({ fotos: [foto('a.jpg'), foto('b.exe')] }));
    expect(r).toEqual({ ok: false, motivo: 'campos', campos: { adjuntos: 'tipo' } });
    expect(f.descartarMedia).toHaveBeenCalledWith(['foto-1']);
  });

  it('guarda el video por su tipo real', async () => {
    const f = fuente();
    await procesarGarantia(f, entrada({ video: { buffer: MOV, nombre: 'caso.mp4' } }));
    expect(f.guardarVideo).toHaveBeenCalledWith(MOV, 'mov', 'caso.mp4');
    const g = fuente();
    const r = await procesarGarantia(g, entrada({ video: { buffer: Buffer.from('no es un video'), nombre: 'v.mp4' } }));
    expect(r).toEqual({ ok: false, motivo: 'campos', campos: { adjuntos: 'tipo' } });
  });
});

describe('textos', () => {
  it('no afirman originalidad, autenticidad ni certificados (regla 7)', () => {
    const planos: string[] = [];
    const recorrer = (v: unknown) => {
      if (typeof v === 'string') planos.push(v);
      else if (typeof v === 'function') planos.push(String((v as (...a: unknown[]) => unknown)(v.name === 'ejemploPedido' ? 'co' : 1, 2)));
      else if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
    };
    recorrer(TG);
    expect(planos.length).toBeGreaterThan(30);
    for (const t of planos) expect(afirmaOriginalidad(t)).toBeFalsy();
  });
});
