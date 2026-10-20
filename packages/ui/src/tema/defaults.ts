/**
 * Valores por defecto del tema (§8.1, §8.2). Son los mismos del seed de `site_settings`;
 * la base manda: el panel los edita y `construirCssTema` los pisa. Este archivo es el único
 * lugar del código donde viven colores en hex (`tokens.css` los repite y una prueba los sincroniza).
 */

export const CLAVES_COLOR = [
  'bg',
  'surface',
  'accent',
  'muted',
  'ink',
  'ink-hover',
  'success',
  'danger',
] as const;
export type ClaveColor = (typeof CLAVES_COLOR)[number];

export const COLORES_POR_DEFECTO: Readonly<Record<ClaveColor, string>> = Object.freeze({
  bg: '#FDFBF7',
  surface: '#EADCC9',
  accent: '#CBA8A8',
  muted: '#8E7564',
  ink: '#382E2B',
  'ink-hover': '#4A3D39',
  success: '#5E7A5A',
  danger: '#A4483B',
});

/** Divisores finos: tinta al 12 % (derivado del color `ink` salvo que el panel lo fije). */
export const LINEA_POR_DEFECTO = 'color-mix(in srgb, var(--color-ink) 12%, transparent)';

export interface ParTipografico {
  readonly id: 1 | 2 | 3 | 4 | 5 | 6;
  readonly titulos: string;
  readonly texto: string;
  readonly caracter: string;
}

/** Parejas curadas de §8.2. */
export const PARES_TIPOGRAFICOS: readonly ParTipografico[] = Object.freeze([
  { id: 1, titulos: 'Cormorant Garamond', texto: 'Manrope', caracter: 'Editorial, lujo cálido' },
  { id: 2, titulos: 'Playfair Display', texto: 'Jost', caracter: 'Clásico moderno' },
  { id: 3, titulos: 'Fraunces', texto: 'Inter Tight', caracter: 'Contemporáneo con calidez' },
  { id: 4, titulos: 'Libre Caslon Display', texto: 'Karla', caracter: 'Revista de moda' },
  { id: 5, titulos: 'Marcellus', texto: 'Mulish', caracter: 'Sereno, inscripción' },
  { id: 6, titulos: 'Bodoni Moda', texto: 'DM Sans', caracter: 'Alto contraste, perfumería clásica' },
]);

export interface TipografiaTema {
  readonly par: ParTipografico['id'];
  /** Escala base en px (15–18). */
  readonly baseSizePx: number;
  readonly pesoTitulos: number;
  /** Espaciado de letras de los títulos, en em. */
  readonly espaciadoTitulos: string;
  /** Espaciado de las etiquetas en versalitas. */
  readonly espaciadoEtiquetas: string;
}

export const TIPOGRAFIA_POR_DEFECTO: TipografiaTema = Object.freeze({
  par: 1,
  baseSizePx: 16,
  pesoTitulos: 500,
  espaciadoTitulos: '0em',
  espaciadoEtiquetas: '0.14em',
});

export const BASE_MIN_PX = 15;
export const BASE_MAX_PX = 18;
