import { describe, expect, it } from 'vitest';
import { LARGO_MAXIMO_DESCRIPCION, recortarDescripcion, SEO_POR_DEFECTO, textosSeo } from './seo-textos';

describe('textosSeo', () => {
  it('sin espacios usa el texto del seed y es distinto por país', () => {
    const co = textosSeo('co', []);
    const ec = textosSeo('ec', []);
    expect(co.inicioDescripcion).toBe(SEO_POR_DEFECTO.co.inicioDescripcion);
    expect(co.inicioDescripcion).not.toBe(ec.inicioDescripcion);
    expect(co.catalogoDescripcion).not.toBe(ec.catalogoDescripcion);
    expect(co.inicioTitulo).not.toBe(ec.inicioTitulo);
  });

  it('las descripciones del seed caben en 160 caracteres y no afirman originalidad ni marcas', () => {
    for (const p of ['co', 'ec'] as const) {
      for (const t of [SEO_POR_DEFECTO[p].inicioDescripcion, SEO_POR_DEFECTO[p].catalogoDescripcion]) {
        expect(t.length).toBeLessThanOrEqual(LARGO_MAXIMO_DESCRIPCION);
        expect(t.length).toBeGreaterThan(70);
        expect(t).not.toMatch(/original|aut[eé]ntic|certific|oficial|distribuidor/i);
      }
    }
  });

  it('el panel manda y un campo vacío vuelve al seed', () => {
    const r = textosSeo('ec', [
      { key: 'seo_inicio', title: '  Fragancias en Quito  ', body: ' Aromas para cada día. ' },
      { key: 'seo_catalogo', title: null, body: '   ' },
    ]);
    expect(r.inicioTitulo).toBe('Fragancias en Quito');
    expect(r.inicioDescripcion).toBe('Aromas para cada día.');
    expect(r.catalogoDescripcion).toBe(SEO_POR_DEFECTO.ec.catalogoDescripcion);
  });
});

describe('recortarDescripcion', () => {
  it('no toca los textos cortos y colapsa espacios', () => {
    expect(recortarDescripcion('  hola   mundo ')).toBe('hola mundo');
  });
  it('recorta sin partir palabras y cierra con puntos suspensivos', () => {
    const largo = 'aroma '.repeat(60);
    const r = recortarDescripcion(largo);
    expect(r.length).toBeLessThanOrEqual(LARGO_MAXIMO_DESCRIPCION);
    expect(r.endsWith('…')).toBe(true);
    expect(r).not.toMatch(/aro…$/);
  });
});
