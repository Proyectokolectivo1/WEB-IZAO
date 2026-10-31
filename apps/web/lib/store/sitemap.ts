/**
 * Sitemaps y robots (§5.2, §26): constructores de XML/TXT puros. Cada país tiene el suyo (`/co/sitemap.xml`,
 * `/ec/sitemap.xml`) y `/sitemap.xml` es el índice; solo incluyen lo que se vende en ese país (el catálogo ya viene
 * filtrado por país y visibilidad). Sin rutas privadas: carrito, checkout, pedido, pago, buscador ni panel.
 */

export interface EntradaSitemap {
  /** Ruta absoluta desde la raíz del sitio: `/co/perfume/cuero-suave`. */
  ruta: string;
  /** Fecha ISO (`YYYY-MM-DD` o con hora) de la última modificación, si se conoce. */
  modificado?: string | null;
}

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ENTIDADES[c] ?? c);

/** Quita la barra final del origen y valida que sea http(s). */
export function origenSitio(crudo: string): string {
  const o = crudo.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(o) ? o : 'https://izaoperfumeria.com';
}

const fechaCorta = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export function xmlUrlset(origen: string, entradas: readonly EntradaSitemap[]): string {
  const base = origenSitio(origen);
  const cuerpo = entradas
    .map((e) => {
      const m = fechaCorta(e.modificado);
      return `  <url><loc>${escapar(base + e.ruta)}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`;
}

export function xmlIndice(origen: string, rutas: readonly string[]): string {
  const base = origenSitio(origen);
  const cuerpo = rutas.map((r) => `  <sitemap><loc>${escapar(base + r)}</loc></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</sitemapindex>\n`;
}

/** Rutas privadas o sin valor para buscadores (cada una por país con comodín). */
const PRIVADAS_POR_PAIS = ['carrito', 'checkout', 'pedido', 'pagar', 'buscar', 'cambiar-pais'] as const;

export function textoRobots(origen: string, paises: readonly string[]): string {
  const base = origenSitio(origen);
  const lineas = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/'];
  for (const r of PRIVADAS_POR_PAIS) lineas.push(`Disallow: /*/${r}`);
  lineas.push('', `Sitemap: ${base}/sitemap.xml`, ...paises.map((p) => `Sitemap: ${base}/${p}/sitemap.xml`));
  return `${lineas.join('\n')}\n`;
}
