import type { Metadata } from 'next';
import { parsearEstado } from './filtros';
import { PAISES, hreflangDe } from './pais';
import { T } from './textos';
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

/**
 * Metadatos de un listado. El canónico apunta a la ruta sin filtros (o a `?page=N` si solo se pagina);
 * con filtros, orden o búsqueda se pide `noindex, follow` para no duplicar contenido.
 */
export function metaListado(
  pais: CodigoPais,
  base: string,
  titulo: string,
  params: Record<string, string | string[] | undefined>,
  /** `idiomas: false` en rutas con slug propio del país (puede no existir en el otro). */
  opciones: { descripcion?: string | null; noIndexar?: boolean; idiomas?: boolean } = {},
): Metadata {
  const estado = parsearEstado(params);
  const conFiltros = Object.keys(estado.filtros).length > 0 || estado.q.length > 0 || Object.keys(params).some((k) => k === 'orden');
  const ruta = estado.pagina > 1 && !conFiltros ? `${base}?page=${estado.pagina}` : base;
  return {
    title: estado.pagina > 1 ? `${titulo} · ${T.listado.paginaN(estado.pagina)}` : titulo,
    description: opciones.descripcion ?? undefined,
    alternates: {
      canonical: ruta,
      ...(opciones.idiomas === false ? {} : { languages: Object.fromEntries(PAISES.map((p) => [hreflangDe(p), base.replace(`/${pais}`, `/${p}`)])) }),
    },
    robots: conFiltros || opciones.noIndexar ? { index: false, follow: true } : undefined,
  };
}
