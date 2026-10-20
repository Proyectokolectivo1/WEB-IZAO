/**
 * Las seis parejas de §8.2, autohospedadas por `next/font` (se descargan al compilar; en ejecución no hay
 * dependencia de Google). Solo la pareja por defecto se precarga: las demás declaran sus `@font-face`
 * pero el navegador baja únicamente los archivos de la pareja que el panel haya elegido.
 */
import {
  Bodoni_Moda,
  Cormorant_Garamond,
  DM_Sans,
  Fraunces,
  Inter_Tight,
  Jost,
  Karla,
  Libre_Caslon_Display,
  Manrope,
  Marcellus,
  Mulish,
  Playfair_Display,
} from 'next/font/google';

const comun = { subsets: ['latin'] as ['latin'], display: 'swap' as const };
const secundaria = { ...comun, preload: false };

const p1t = Cormorant_Garamond({ ...comun, weight: ['400', '500', '600', '700'], style: ['normal', 'italic'], variable: '--font-par1-titulos' });
const p1x = Manrope({ ...comun, variable: '--font-par1-texto' });
const p2t = Playfair_Display({ ...secundaria, variable: '--font-par2-titulos' });
const p2x = Jost({ ...secundaria, variable: '--font-par2-texto' });
const p3t = Fraunces({ ...secundaria, variable: '--font-par3-titulos' });
const p3x = Inter_Tight({ ...secundaria, variable: '--font-par3-texto' });
const p4t = Libre_Caslon_Display({ ...secundaria, weight: '400', variable: '--font-par4-titulos' });
const p4x = Karla({ ...secundaria, variable: '--font-par4-texto' });
const p5t = Marcellus({ ...secundaria, weight: '400', variable: '--font-par5-titulos' });
const p5x = Mulish({ ...secundaria, variable: '--font-par5-texto' });
const p6t = Bodoni_Moda({ ...secundaria, variable: '--font-par6-titulos' });
const p6x = DM_Sans({ ...secundaria, variable: '--font-par6-texto' });

const PARES = {
  1: [p1t, p1x],
  2: [p2t, p2x],
  3: [p3t, p3x],
  4: [p4t, p4x],
  5: [p5t, p5x],
  6: [p6t, p6x],
} as const;

/** Clases que definen `--font-par{N}-titulos` y `--font-par{N}-texto` para la pareja elegida. */
export function clasesFuentes(par: 1 | 2 | 3 | 4 | 5 | 6): string {
  const [t, x] = PARES[par];
  return `${t.variable} ${x.variable}`;
}
