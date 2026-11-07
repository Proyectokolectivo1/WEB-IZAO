import { COLORES_POR_DEFECTO } from './defaults';

/**
 * Favicon neutro por defecto (SVG): un cuadrado redondeado con una «I» dibujada con trazos, sin tipografía ni logo
 * de terceros. Usa los colores del tema por defecto (el seed); cuando el panel sube un favicon en Apariencia
 * (`site_settings.favicon_media_id`) la tienda lo usa en su lugar y este solo es el respaldo.
 */
export function construirIconoPorDefecto(colores: Pick<typeof COLORES_POR_DEFECTO, 'ink' | 'bg'> = COLORES_POR_DEFECTO): string {
  const { ink, bg } = colores;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Izao Perfumería">` +
    `<rect width="64" height="64" rx="14" fill="${ink}"/>` +
    `<path d="M20 15h24v4h-10v26h10v4H20v-4h10V19H20z" fill="${bg}"/>` +
    `</svg>`
  );
}
