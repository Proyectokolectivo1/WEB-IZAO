import type { CodigoPais, TipoPagina } from './types';

/**
 * Etiquetas de la caché de las páginas legales y de contenido libre (tabla `pages`). Sin dependencias de servidor para que
 * el panel las importe: al publicar, despublicar o editar una página llama `revalidateTag` con cada una de estas.
 *
 *   pages:{país}              todas las páginas del país (lista del pie y del checkout)
 *   pages:{país}:{kind}       la página de ese tipo (checkout y pie leen por tipo)
 *   pages:{país}:slug:{slug}  la ficha pública `/{país}/pagina/{slug}`
 */
export function etiquetasPagina(pais: CodigoPais | 'co' | 'ec' | 'CO' | 'EC', kind?: TipoPagina, slug?: string): string[] {
  const p = pais.toLowerCase();
  const out = [`pages:${p}`];
  if (kind) out.push(`pages:${p}:${kind}`);
  if (slug) out.push(`pages:${p}:slug:${slug}`);
  return out;
}
