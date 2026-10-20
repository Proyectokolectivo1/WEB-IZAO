import { describe, expect, it } from 'vitest';
import { calcularVersion, esTipoUnico, esquemaPagina, marcadoresPendientes } from './paginas';

const base = { country_code: 'CO', kind: 'terminos', slug: 'terminos-y-condiciones', title: 'Términos', content_html: '<p>Hola</p>', status: 'draft' };

describe('esquemaPagina', () => {
  it('acepta un tipo válido y depura el HTML al validar', () => {
    const r = esquemaPagina.parse({ ...base, content_html: '<p onclick="x()">Hola</p><script>alert(1)</script><a href="javascript:alert(1)">z</a>' });
    expect(r.content_html).toBe('<p>Hola</p><a>z</a>');
    expect(r.kind).toBe('terminos');
  });

  it('rechaza un tipo desconocido, un país ajeno y un estado inventado', () => {
    expect(esquemaPagina.safeParse({ ...base, kind: 'otro' }).success).toBe(false);
    expect(esquemaPagina.safeParse({ ...base, country_code: 'PE' }).success).toBe(false);
    expect(esquemaPagina.safeParse({ ...base, status: 'archived' }).success).toBe(false);
  });

  it('exige un identificador de URL válido', () => {
    expect(esquemaPagina.safeParse({ ...base, slug: 'Con Espacios' }).success).toBe(false);
  });

  it('el tipo general no es único; los legales sí', () => {
    expect(esTipoUnico('general')).toBe(false);
    expect(esTipoUnico('tratamiento_datos')).toBe(true);
  });
});

describe('marcadoresPendientes', () => {
  it('detecta los mismos marcadores que bloquea la base', () => {
    expect(marcadoresPendientes('<p>NIT [NIT] y [COMPLETAR] y [DIRECCIÓN FÍSICA] y [NIT]</p>')).toEqual(['[NIT]', '[COMPLETAR]', '[DIRECCIÓN FÍSICA]']);
    expect(marcadoresPendientes('<p>Texto [1] normal</p>')).toEqual([]);
  });
});

describe('calcularVersion', () => {
  const publicada = { status: 'published', version: 3, title: 'T', content_html: '<p>a</p>' };
  it('una página nueva empieza en 1', () => {
    expect(calcularVersion(null, { status: 'published', title: 'T', content_html: '' })).toBe(1);
  });
  it('sube al publicar un borrador', () => {
    expect(calcularVersion({ ...publicada, status: 'draft', version: 1 }, { status: 'published', title: 'T', content_html: '<p>a</p>' })).toBe(2);
  });
  it('sube al cambiar el texto o el título de una publicada', () => {
    expect(calcularVersion(publicada, { status: 'published', title: 'T', content_html: '<p>b</p>' })).toBe(4);
    expect(calcularVersion(publicada, { status: 'published', title: 'Otro', content_html: '<p>a</p>' })).toBe(4);
  });
  it('no sube si solo cambia el SEO (mismo título y texto)', () => {
    expect(calcularVersion(publicada, { status: 'published', title: 'T', content_html: '<p>a</p>' })).toBe(3);
  });
  it('un borrador editado o una despublicación conservan la versión', () => {
    expect(calcularVersion(publicada, { status: 'draft', title: 'T', content_html: '<p>b</p>' })).toBe(3);
    expect(calcularVersion({ ...publicada, status: 'draft' }, { status: 'draft', title: 'T', content_html: '<p>b</p>' })).toBe(3);
  });
});
