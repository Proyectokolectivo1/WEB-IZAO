import { describe, expect, it } from 'vitest';
import { TCK, enlacePoliticaDatos, textosCookies } from './textos-cookies';

describe('textos del aviso de cookies', () => {
  it('sin espacios del panel usa los del seed', () => {
    const t = textosCookies([]);
    expect(t.avisoTitulo).toBe(TCK.aviso.titulo);
    expect(t.marketingTexto).toBe(TCK.marketing.texto);
  });

  it('el panel sobrescribe por país campo a campo (vacío = seed)', () => {
    const ec = textosCookies([
      { key: 'cookies_aviso', title: 'Cookies en Izao Ecuador', body: '  Texto de Ecuador.  ' },
      { key: 'cookies_marketing', title: '   ', body: null },
    ]);
    expect(ec.avisoTitulo).toBe('Cookies en Izao Ecuador');
    expect(ec.avisoTexto).toBe('Texto de Ecuador.');
    expect(ec.marketingTitulo).toBe(TCK.marketing.titulo);
    expect(ec.marketingTexto).toBe(TCK.marketing.texto);
  });

  it('los textos por defecto no afirman originalidad ni relación con marcas', () => {
    const todo = JSON.stringify(TCK).toLowerCase();
    expect(todo).not.toMatch(/original|auténtic|autentic|certificad|afiliad|oficial|distribuidor/);
  });

  it('enlaza la política de datos del país solo si está publicada', () => {
    const paginas = [
      { slug: 'politica-de-envios', kind: 'envios' },
      { slug: 'tratamiento-de-datos', kind: 'tratamiento_datos' },
    ];
    expect(enlacePoliticaDatos('co', paginas)).toBe('/co/pagina/tratamiento-de-datos');
    expect(enlacePoliticaDatos('ec', paginas)).toBe('/ec/pagina/tratamiento-de-datos');
    expect(enlacePoliticaDatos('ec', [paginas[0]!])).toBeNull();
  });
});
