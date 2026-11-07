import type { CodigoPais, EspacioContenido } from './types';

/**
 * Títulos y descripciones de buscador (meta description) de la tienda, un texto distinto por país.
 *
 * Los valores de aquí son los del seed (§8.6: sin afirmar originalidad ni relación con marcas). El panel los
 * sobrescribe con espacios de contenido del país (`content_slots`):
 * - `seo_inicio`: título (campo título) y descripción (campo cuerpo) del inicio; la descripción es además la de
 *   respaldo para toda página del país que no traiga la suya (bolso, buscador, categorías…).
 * - `seo_catalogo`: descripción (campo cuerpo) de `/{pais}/catalogo`.
 * Una descripción útil mide entre 70 y 160 caracteres: lo que pase de ahí se recorta sin cortar palabras.
 */
export const SEO_POR_DEFECTO: Record<CodigoPais, { inicioTitulo: string; inicioDescripcion: string; catalogoDescripcion: string }> = {
  co: {
    inicioTitulo: 'Perfumería online en Colombia',
    inicioDescripcion:
      'Encuentra fragancias para hombre, mujer y unisex en Izao Perfumería. Elige tu aroma con calma y recíbelo en tu casa en toda Colombia.',
    catalogoDescripcion:
      'Mira todos los aromas de Izao Perfumería en Colombia: filtra por familia olfativa, precio y disponibilidad, y encuentra el tuyo.',
  },
  ec: {
    inicioTitulo: 'Perfumería online en Ecuador',
    inicioDescripcion:
      'Descubre fragancias para hombre, mujer y unisex en Izao Perfumería. Elige tu aroma, mira los precios en dólares y recíbelo en Ecuador.',
    catalogoDescripcion:
      'Explora todos los aromas de Izao Perfumería en Ecuador: filtra por familia olfativa, precio y disponibilidad, y escoge el tuyo.',
  },
};

export const LARGO_MAXIMO_DESCRIPCION = 160;

/** Recorta en el último espacio antes del límite y cierra con «…». */
export function recortarDescripcion(texto: string, max = LARGO_MAXIMO_DESCRIPCION): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.]+$/, '')}…`;
}

type Espacio = Pick<EspacioContenido, 'key' | 'title' | 'body'>;

const valor = (e: Espacio | undefined, campo: 'title' | 'body'): string | null => e?.[campo]?.trim() || null;

export interface TextosSeo {
  inicioTitulo: string;
  inicioDescripcion: string;
  catalogoDescripcion: string;
}

/** Textos de buscador del país: el panel manda; un campo vacío vuelve al valor por defecto del seed. */
export function textosSeo(pais: CodigoPais, espacios: readonly Espacio[]): TextosSeo {
  const base = SEO_POR_DEFECTO[pais];
  const inicio = espacios.find((e) => e.key === 'seo_inicio');
  const catalogo = espacios.find((e) => e.key === 'seo_catalogo');
  return {
    inicioTitulo: valor(inicio, 'title') ?? base.inicioTitulo,
    inicioDescripcion: recortarDescripcion(valor(inicio, 'body') ?? base.inicioDescripcion),
    catalogoDescripcion: recortarDescripcion(valor(catalogo, 'body') ?? base.catalogoDescripcion),
  };
}
