import { describe, expect, it } from 'vitest';
import {
  configDeSeccion,
  enlaceSeguro,
  entradaSeccion,
  esquemaSeccion,
  moverSeccion,
  siguienteOrden,
  valoresDeConfig,
} from './home';

const lista = [
  { id: 'a', sort_order: 10 },
  { id: 'b', sort_order: 20 },
  { id: 'c', sort_order: 30 },
];

describe('moverSeccion', () => {
  it('sube una posición y devuelve solo lo que cambia de número', () => {
    expect(moverSeccion(lista, 'b', 'arriba')).toEqual([
      { id: 'b', sort_order: 10 },
      { id: 'a', sort_order: 20 },
    ]);
    expect(moverSeccion(lista, 'b', 'abajo')).toEqual([
      { id: 'c', sort_order: 20 },
      { id: 'b', sort_order: 30 },
    ]);
  });

  it('no mueve más allá de los bordes ni ids desconocidos', () => {
    expect(moverSeccion(lista, 'a', 'arriba')).toBeNull();
    expect(moverSeccion(lista, 'c', 'abajo')).toBeNull();
    expect(moverSeccion(lista, 'zzz', 'abajo')).toBeNull();
  });

  it('renumera cuando hay órdenes repetidos o huecos raros', () => {
    const raro = [{ id: 'a', sort_order: 1 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 99 }];
    const r = moverSeccion(raro, 'c', 'arriba')!;
    expect(Object.fromEntries(r.map((x) => [x.id, x.sort_order]))).toEqual({ a: 10, b: 30, c: 20 });
  });

  it('el siguiente orden va al final', () => {
    expect(siguienteOrden(lista)).toBe(40);
    expect(siguienteOrden([])).toBe(10);
  });
});

describe('enlaceSeguro', () => {
  it('acepta rutas del sitio y https; rechaza el resto', () => {
    for (const ok of ['/co/contacto', '/', 'https://wa.me/573000000000']) expect(enlaceSeguro(ok), ok).toBe(true);
    for (const malo of ['//otro.com', '/\\otro.com', 'javascript:alert(1)', 'http://inseguro.com', 'ftp://x', 'co/contacto']) {
      expect(enlaceSeguro(malo), malo).toBe(false);
    }
  });
});

describe('esquemaSeccion', () => {
  const base = { type: 'advice', is_active: 'on', title: ' ¿Dudas? ', body: 'Escríbenos', cta_label: 'Hablar con Iza', cta_url: '/co/asesoria' };

  it('asesoría: normaliza y arma el config conservando claves desconocidas', () => {
    const d = esquemaSeccion.parse(entradaSeccion(base));
    expect(d).toMatchObject({ type: 'advice', is_active: true, title: '¿Dudas?', cta_url: '/co/asesoria', beneficios: [] });
    expect(configDeSeccion({ title: 'viejo', body: 'x', futuro: 1, cta_url: '/x' }, { ...d, cta_url: null })).toEqual({
      title: '¿Dudas?',
      body: 'Escríbenos',
      cta_label: 'Hablar con Iza',
      futuro: 1,
    });
  });

  it('asesoría: un botón sin destino o con un destino peligroso se rechaza', () => {
    expect(esquemaSeccion.safeParse(entradaSeccion({ ...base, cta_url: '' })).success).toBe(false);
    expect(esquemaSeccion.safeParse(entradaSeccion({ ...base, cta_url: 'javascript:alert(1)' })).success).toBe(false);
    expect(esquemaSeccion.safeParse(entradaSeccion({ ...base, cta_label: '', cta_url: '' })).success).toBe(true);
  });

  it('beneficios: descarta filas vacías, valida íconos y exige al menos uno', () => {
    const f = { type: 'benefits', title: '', benef_0_icon: 'camion', benef_0_title: 'Envío gratis', benef_0_text: '', benef_1_icon: 'check', benef_1_title: '  ', benef_2_icon: 'escudo', benef_2_title: 'Garantía', benef_2_text: '30 días' };
    const d = esquemaSeccion.parse(entradaSeccion(f));
    expect(d.beneficios).toEqual([
      { icon: 'camion', title: 'Envío gratis', text: null },
      { icon: 'escudo', title: 'Garantía', text: '30 días' },
    ]);
    expect(configDeSeccion(null, d)).toEqual({ items: [{ icon: 'camion', title: 'Envío gratis' }, { icon: 'escudo', title: 'Garantía', text: '30 días' }] });
    expect(esquemaSeccion.safeParse(entradaSeccion({ type: 'benefits' })).success).toBe(false);
    expect(esquemaSeccion.safeParse(entradaSeccion({ ...f, benef_0_icon: 'cohete' })).success).toBe(false);
  });

  it('las demás secciones solo guardan el título y borran el viejo si queda vacío', () => {
    const d = esquemaSeccion.parse(entradaSeccion({ type: 'reviews', title: '' }));
    expect(configDeSeccion({ title: 'Viejo', otra: true }, d)).toEqual({ otra: true });
    expect(esquemaSeccion.safeParse(entradaSeccion({ type: 'inventada' })).success).toBe(false);
    expect(esquemaSeccion.safeParse(entradaSeccion({ type: 'hero', title: 'x'.repeat(81) })).success).toBe(false);
  });
});

describe('valoresDeConfig', () => {
  it('lee el config guardado tolerando formas raras', () => {
    expect(valoresDeConfig({ title: 'T', items: [{ icon: 'cohete', title: 'A' }, { icon: 'hoja', title: 'B', text: 'x' }] })).toMatchObject({
      title: 'T',
      beneficios: [{ icon: 'check', title: 'A', text: '' }, { icon: 'hoja', title: 'B', text: 'x' }],
    });
    expect(valoresDeConfig({ title: 5, items: 'no' })).toMatchObject({ title: '', beneficios: [] });
  });
});
