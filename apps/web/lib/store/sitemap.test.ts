import { describe, expect, it } from 'vitest';
import { origenSitio, textoRobots, xmlIndice, xmlUrlset } from './sitemap';

describe('sitemap', () => {
  it('arma el urlset con fechas cortas y escapa lo que hay que escapar', () => {
    const x = xmlUrlset('https://izaoperfumeria.com/', [
      { ruta: '/co' },
      { ruta: '/co/perfume/a&b', modificado: '2026-10-05T12:00:00Z' },
      { ruta: '/co/perfume/c', modificado: 'no es fecha' },
    ]);
    expect(x).toContain('<loc>https://izaoperfumeria.com/co</loc>');
    expect(x).toContain('<loc>https://izaoperfumeria.com/co/perfume/a&amp;b</loc><lastmod>2026-10-05</lastmod>');
    expect(x).not.toContain('lastmod>no es');
    expect(x.startsWith('<?xml')).toBe(true);
  });
  it('el índice apunta al sitemap de cada país', () => {
    const x = xmlIndice('https://izaoperfumeria.com', ['/co/sitemap.xml', '/ec/sitemap.xml']);
    expect(x).toContain('<loc>https://izaoperfumeria.com/co/sitemap.xml</loc>');
    expect(x).toContain('<loc>https://izaoperfumeria.com/ec/sitemap.xml</loc>');
  });
  it('un origen inválido cae al dominio oficial', () => {
    expect(origenSitio('javascript:alert(1)')).toBe('https://izaoperfumeria.com');
    expect(origenSitio('http://localhost:3100/')).toBe('http://localhost:3100');
  });
  it('robots cierra panel, API y pantallas privadas, y lista los sitemaps', () => {
    const t = textoRobots('https://izaoperfumeria.com', ['co', 'ec']);
    for (const d of ['Disallow: /admin', 'Disallow: /api/', 'Disallow: /*/checkout', 'Disallow: /*/carrito', 'Disallow: /*/pedido', 'Disallow: /*/pagar']) expect(t).toContain(d);
    expect(t).toContain('Sitemap: https://izaoperfumeria.com/sitemap.xml');
    expect(t).toContain('Sitemap: https://izaoperfumeria.com/ec/sitemap.xml');
  });
});
