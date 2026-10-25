import { describe, expect, it } from 'vitest';
import {
  destacadaTrasModerar,
  destacadaValida,
  esquemaResenaAdmin,
  leerFiltrosResena,
  parametrosDeFiltrosResena,
  resenaAfirmaOriginalidad,
} from './resenas';

const base = { country_code: 'CO', product_slug: '', author_name: ' Laura ', city: 'Medellín', rating: '5', body: 'Me llegó muy bien empacado y dura todo el día.', status: 'approved' };

describe('filtros', () => {
  it('por defecto muestra las que esperan revisión', () => {
    expect(leerFiltrosResena({})).toEqual({ pagina: 1, estado: 'pending', pais: '', fuente: '', soloDestacadas: false });
  });

  it('lee filtros válidos, descarta los desconocidos y los conserva para volver', () => {
    const f = leerFiltrosResena({ estado: 'todas', pais: 'ec', fuente: 'admin', destacadas: '1', page: '2' });
    expect(f).toEqual({ pagina: 2, estado: 'todas', pais: 'EC', fuente: 'admin', soloDestacadas: true });
    expect(parametrosDeFiltrosResena(f)).toEqual({ estado: 'todas', pais: 'EC', fuente: 'admin', destacadas: '1' });
    expect(leerFiltrosResena({ estado: 'x', pais: 'MX', fuente: 'bot', page: '-1' })).toMatchObject({ estado: 'pending', pais: '', fuente: '', pagina: 1 });
  });
});

describe('moderación', () => {
  it('solo una reseña aprobada puede estar destacada', () => {
    expect(destacadaValida('approved', true)).toBe(true);
    expect(destacadaValida('pending', true)).toBe(false);
    expect(destacadaValida('rejected', true)).toBe(false);
    expect(destacadaValida('pending', false)).toBe(true);
  });

  it('rechazar o devolver a revisión quita el destacado; aprobar lo conserva', () => {
    expect(destacadaTrasModerar('rejected', true)).toBe(false);
    expect(destacadaTrasModerar('pending', true)).toBe(false);
    expect(destacadaTrasModerar('approved', true)).toBe(true);
    expect(destacadaTrasModerar('approved', false)).toBe(false);
  });

  it('avisa de textos que afirman originalidad (regla 7)', () => {
    expect(resenaAfirmaOriginalidad({ author_name: 'Ana', body: 'Es 100% original, lo recomiendo' })).toBe(true);
    expect(resenaAfirmaOriginalidad({ author_name: 'Ana', body: 'Producto auténtico' })).toBe(true);
    expect(resenaAfirmaOriginalidad({ author_name: 'Ana', body: 'Huele delicioso' })).toBe(false);
    expect(resenaAfirmaOriginalidad({ author_name: 'Ana', body: null })).toBe(false);
  });
});

describe('esquemaResenaAdmin', () => {
  it('normaliza y devuelve la calificación como número', () => {
    const d = esquemaResenaAdmin.parse({ ...base, product_slug: ' Sauvage-EDP ' });
    expect(d).toMatchObject({ author_name: 'Laura', rating: 5, product_slug: 'sauvage-edp', status: 'approved', featured_home: false, id: null });
    expect(esquemaResenaAdmin.parse(base).product_slug).toBeNull();
  });

  it('rechaza calificaciones fuera de rango, textos cortos y URLs de producto con barras', () => {
    for (const rating of ['0', '6', 'cinco', '']) expect(esquemaResenaAdmin.safeParse({ ...base, rating }).success, rating).toBe(false);
    expect(esquemaResenaAdmin.safeParse({ ...base, body: 'bueno' }).success).toBe(false);
    expect(esquemaResenaAdmin.safeParse({ ...base, product_slug: '/co/producto/x' }).success).toBe(false);
    expect(esquemaResenaAdmin.safeParse({ ...base, status: 'otro' }).success).toBe(false);
  });

  it('regla 7: ni el texto, ni el nombre, ni la ciudad afirman originalidad', () => {
    expect(esquemaResenaAdmin.safeParse({ ...base, body: 'Perfume 100% original y certificado, excelente' }).success).toBe(false);
    expect(esquemaResenaAdmin.safeParse({ ...base, city: 'Original' }).success).toBe(false);
  });

  it('no deja destacar una reseña que no está aprobada', () => {
    expect(esquemaResenaAdmin.safeParse({ ...base, status: 'pending', featured_home: 'on' }).success).toBe(false);
    expect(esquemaResenaAdmin.safeParse({ ...base, featured_home: 'on' }).success).toBe(true);
  });
});
