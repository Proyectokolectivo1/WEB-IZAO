/**
 * Arreglos de la tienda tras las pruebas de lanzamiento F9 (D-4, D-8 y la home a 375 px):
 *  - meta description en inicio, catálogo y bolso, distinta por país;
 *  - favicon declarado en <head> y respondiendo 200;
 *  - la sección de categorías del inicio tiene título y tarjetas visibles (sin una cabecera «01» suelta).
 */
import { expect, test, type Page } from '@playwright/test';
import { PAISES } from '../support/entorno';
import { RUTAS } from '../support/rutas';

const meta = (p: Page) => p.locator('meta[name="description"]').getAttribute('content');

test.describe('SEO y favicon (F9 D-4 / D-8)', () => {
  for (const pais of PAISES) {
    test(`/${pais}: inicio y catálogo traen meta description y título propio`, async ({ page }) => {
      await page.goto(RUTAS.home(pais));
      const inicio = (await meta(page)) ?? '';
      expect(inicio.length).toBeGreaterThan(70);
      expect(inicio.length).toBeLessThanOrEqual(160);
      expect(inicio).not.toMatch(/original|aut[eé]ntic|certific|oficial/i);
      await expect(page).toHaveTitle(/Perfumería online/);

      await page.goto(RUTAS.catalogo(pais));
      const catalogo = (await meta(page)) ?? '';
      expect(catalogo.length).toBeGreaterThan(70);
      expect(catalogo).not.toBe(inicio);
    });

    test(`/${pais}/carrito hereda la descripción del país`, async ({ page }) => {
      await page.goto(`/${pais}/carrito`);
      expect(((await meta(page)) ?? '').length).toBeGreaterThan(70);
    });
  }

  test('la descripción del inicio es distinta en cada país', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    const co = await meta(page);
    await page.goto(RUTAS.home('ec'));
    const ec = await meta(page);
    expect(co).toBeTruthy();
    expect(ec).toBeTruthy();
    expect(co).not.toBe(ec);
  });

  test('favicon: <link rel="icon"> y el archivo responde 200', async ({ page, request }) => {
    await page.goto(RUTAS.home('co'));
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const r = await request.get(href!);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toMatch(/image\//);
  });
});

test.describe('Inicio a 375 px (F9, sección vacía sobre las categorías)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('la sección de categorías tiene título y tarjetas con nombre', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    const titulo = page.getByRole('heading', { level: 2, name: 'Empieza por lo que te provoca' });
    await titulo.scrollIntoViewIfNeeded();
    await expect(titulo).toBeVisible();
    const lista = page.locator('section', { has: titulo }).locator('ul a');
    await expect(lista.first()).toBeVisible();
    expect(await lista.count()).toBeGreaterThan(0);
  });
});
