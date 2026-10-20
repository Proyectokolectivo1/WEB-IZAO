import { PAISES, hreflangDe } from './pais';
import type { CodigoPais } from './types';

export const SITIO = process.env.SITE_URL ?? 'https://izaoperfumeria.com';

/** `canonical` y `hreflang` de una ruta que existe igual en ambos países (inicio, listados, buscador). */
export function alternos(pais: CodigoPais, ruta: string) {
  const r = ruta === '/' ? '' : ruta;
  return {
    canonical: `/${pais}${r}`,
    languages: {
      ...Object.fromEntries(PAISES.map((p) => [hreflangDe(p), `/${p}${r}`])),
      'x-default': `/co${r}`,
    },
  };
}

/** JSON-LD seguro para incrustar en `<script>` (evita cerrar la etiqueta con `</`). */
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\u003c');
}
