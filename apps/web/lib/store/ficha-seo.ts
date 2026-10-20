/**
 * Datos estructurados (JSON-LD) y descripciones de la ficha (§7.6).
 * Reglas: `Product` + `Offer` + `AggregateRating`, SIN el campo `brand` y sin ninguna afirmación de
 * originalidad o afiliación (regla 7). Los montos salen del entero en unidad menor, sin pasar por floats.
 */
import { aTextoEditable, monedaDe } from './pais';
import type { CodigoPais, FichaProducto, MediaRef } from './types';

/** Quita etiquetas y espacios repetidos; recorta en una palabra completa. */
export function textoPlano(html: string | null | undefined, max = 300): string {
  const limpio = (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), max - 40)).trimEnd()}…`;
}

/** Ruta pública de la variante más cercana a `ancho` px (la más grande si ninguna llega). */
export function rutaDeMedio(media: MediaRef | null | undefined, ancho = 1200): { ruta: string; ancho: number | null; alto: number | null } | null {
  const entradas = Object.entries(media?.variants ?? {})
    .map(([w, r]) => [Number(w), r] as const)
    .filter(([w, r]) => Number.isFinite(w) && w > 0 && typeof r === 'string' && r.length > 0)
    .sort((a, b) => a[0] - b[0]);
  if (entradas.length === 0) return null;
  const elegida = entradas.find(([w]) => w >= ancho) ?? entradas[entradas.length - 1]!;
  const ratio = media?.width && media?.height ? media.height / media.width : null;
  return {
    ruta: `/media/${elegida[1].replace(/^\/+/, '')}`,
    ancho: elegida[0],
    alto: ratio ? Math.round(elegida[0] * ratio) : null,
  };
}

/** Imágenes de la ficha en orden: las de la galería, o la principal si no hay galería. */
export function imagenesDe(ficha: Pick<FichaProducto, 'images' | 'img_primary'>): MediaRef[] {
  if (ficha.images.length > 0) return [...ficha.images].sort((a, b) => a.sort_order - b.sort_order).map((i) => i.media);
  return ficha.img_primary ? [ficha.img_primary] : [];
}

export function descripcionCorta(ficha: Pick<FichaProducto, 'seo_description' | 'short_description' | 'description_html'>): string | undefined {
  const t = textoPlano(ficha.seo_description ?? ficha.short_description ?? ficha.description_html, 200);
  return t || undefined;
}

export interface OpcionesJsonLd {
  sitio: string;
  nombreTienda: string;
}

export function jsonLdProducto(ficha: FichaProducto, pais: CodigoPais, { sitio, nombreTienda }: OpcionesJsonLd) {
  const url = `${sitio}/${pais}/perfume/${ficha.slug}`;
  const moneda = monedaDe(pais);
  const imagenes = imagenesDe(ficha)
    .map((m) => rutaDeMedio(m))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => `${sitio}${r.ruta}`);
  const ofertas = ficha.variants.map((v) => ({
    '@type': 'Offer',
    url,
    ...(v.sku ? { sku: v.sku } : {}),
    price: aTextoEditable(v.price, pais),
    priceCurrency: moneda,
    availability: v.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: nombreTienda },
  }));
  const { avg, count } = ficha.reviews;
  const producto: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: ficha.name,
    url,
    ...(descripcionCorta(ficha) ? { description: descripcionCorta(ficha) } : {}),
    ...(imagenes.length ? { image: imagenes } : {}),
    ...(ficha.variants[0]?.sku ? { sku: ficha.variants[0].sku } : {}),
    ...(ofertas.length ? { offers: ofertas.length === 1 ? ofertas[0] : ofertas } : {}),
    ...(avg !== null && count > 0
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(avg.toFixed(1)), reviewCount: count, bestRating: 5, worstRating: 1 } }
      : {}),
  };
  return producto;
}

export function jsonLdMigas(pais: CodigoPais, sitio: string, migas: { nombre: string; ruta: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: migas.map((m, k) => ({ '@type': 'ListItem', position: k + 1, name: m.nombre, item: `${sitio}/${pais}${m.ruta}` })),
  };
}
