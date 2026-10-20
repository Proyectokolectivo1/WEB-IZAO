import { describe, expect, it } from 'vitest';
import { etiquetasPagina } from './etiquetas';
import { normalizarTipo, ordenarPaginas, paginaDeTipo } from './paginas';
import type { PaginaListada } from './types';

const p = (slug: string, title: string, kind: PaginaListada['kind']): PaginaListada => ({ slug, title, kind });

describe('páginas por tipo', () => {
  const lista = [p('faq', 'Preguntas', 'general'), p('x-datos', 'Mis datos', 'tratamiento_datos'), p('t', 'Reglas de compra', 'terminos'), p('envios', 'Envíos', 'envios')];

  it('elige por kind aunque el slug o el título no lo digan', () => {
    expect(paginaDeTipo(lista, 'terminos')?.slug).toBe('t');
    expect(paginaDeTipo(lista, 'tratamiento_datos')?.slug).toBe('x-datos');
    expect(paginaDeTipo(lista, 'devoluciones')).toBeNull();
  });

  it('el pie lleva primero las páginas con tipo y al final las generales', () => {
    expect(ordenarPaginas(lista).map((x) => x.slug)).toEqual(['envios', 't', 'x-datos', 'faq']);
  });

  it('un tipo desconocido cuenta como general', () => {
    expect(normalizarTipo('otra_cosa')).toBe('general');
    expect(normalizarTipo('terminos')).toBe('terminos');
    expect(normalizarTipo(null)).toBe('general');
  });

  it('etiquetas de caché por país, tipo y slug', () => {
    expect(etiquetasPagina('CO')).toEqual(['pages:co']);
    expect(etiquetasPagina('ec', 'terminos', 'tyc')).toEqual(['pages:ec', 'pages:ec:terminos', 'pages:ec:slug:tyc']);
  });
});
