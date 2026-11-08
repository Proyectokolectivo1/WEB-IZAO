/**
 * Carrusel de banners arriba del catálogo (`/co/catalogo`), alimentado por los banners `hero` del país (datos de ejemplo:
 * tres banners). Avance automático, pausa con el foco, flechas, puntos, destino del clic, anclas de sección y que ocupe
 * su lugar antes del título (sin mover el listado cuando cargan las imágenes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { RUTAS } from '../support/rutas';

const punto = (page: Page, k: number) => page.getByTestId('hero-punto').nth(k);

test.describe('Carrusel del catálogo', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('aparece arriba del título del catálogo, con flechas (escritorio), puntos y sin salto de diseño', async ({ page }, info) => {
    await page.goto(RUTAS.catalogo('co'));
    const carrusel = page.getByTestId('hero-carrusel');
    await expect(carrusel).toBeVisible();
    const cajaCarrusel = await carrusel.boundingBox();
    const cajaTitulo = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(cajaCarrusel!.y + cajaCarrusel!.height).toBeLessThanOrEqual(cajaTitulo!.y + 1);
    await expect(page.getByTestId('hero-punto')).toHaveCount(3);
    if (info.project.name === 'escritorio') {
      await expect(page.getByTestId('hero-carrusel').getByRole('button', { name: 'Siguiente', exact: true })).toBeVisible();
      await expect(page.getByTestId('hero-carrusel').getByRole('button', { name: 'Anterior', exact: true })).toBeVisible();
    }
    // La proporción está reservada: cuando terminan de cargar las imágenes el alto no cambia.
    const antes = (await carrusel.boundingBox())!.height;
    await page.waitForLoadState('load');
    await page.waitForTimeout(600);
    expect((await carrusel.boundingBox())!.height).toBeCloseTo(antes, 0);
    expect(cajaCarrusel!.height).toBeGreaterThan(150);
  });

  test('cabe en celular y tablet sin desbordar horizontalmente', async ({ page }) => {
    for (const ancho of [375, 768]) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.goto(RUTAS.catalogo('co'));
      await expect(page.getByTestId('hero-carrusel')).toBeVisible();
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde).toBeLessThanOrEqual(0);
      const caja = (await page.getByTestId('hero-carrusel').boundingBox())!;
      expect(caja.width).toBeLessThanOrEqual(ancho);
    }
  });

  test('avanza solo con el tiempo del panel y se detiene con el foco', async ({ page }) => {
    await page.clock.install();
    await page.goto(RUTAS.catalogo('co'));
    await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
    await page.clock.runFor(6_300); // datos de ejemplo: 6 s
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
    await punto(page, 1).focus();
    await page.clock.runFor(30_000);
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
  });

  test('los puntos y las flechas cambian de imagen', async ({ page }, info) => {
    await page.goto(RUTAS.catalogo('co'));
    await punto(page, 2).click();
    await expect(punto(page, 2)).toHaveAttribute('aria-current', 'true');
    if (info.project.name === 'escritorio') {
      await page.getByTestId('hero-carrusel').getByRole('button', { name: 'Siguiente', exact: true }).click();
      await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true'); // da la vuelta
      await page.getByTestId('hero-carrusel').getByRole('button', { name: 'Anterior', exact: true }).click();
      await expect(punto(page, 2)).toHaveAttribute('aria-current', 'true');
    }
  });

  test('deslizar con el dedo cambia de imagen (táctil)', async ({ page }, info) => {
    test.skip(info.project.name !== 'movil', 'Solo en el proyecto táctil.');
    await page.goto(RUTAS.catalogo('co'));
    const caja = (await page.getByTestId('hero-carrusel').boundingBox())!;
    const y = caja.y + caja.height / 2;
    // Dedo real: eventos táctiles por el protocolo del navegador (el ratón no es un deslizamiento táctil).
    const cdp = await page.context().newCDPSession(page);
    const x0 = caja.x + caja.width * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let k = 1; k <= 6; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - (caja.width * 0.6 * k) / 6, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
  });

  test('cada imagen lleva a su destino: página del país y ficha de producto', async ({ page }) => {
    await page.goto(RUTAS.catalogo('co'));
    const activo = page.getByTestId('hero-diapositiva').nth(0);
    await expect(activo.getByRole('link', { name: 'Descubrir' })).toHaveAttribute('href', '/co/catalogo');
    await punto(page, 1).click();
    const enlaceFicha = page.getByTestId('hero-diapositiva').nth(1).getByRole('link', { name: 'Ver el aroma' });
    await expect(enlaceFicha).toHaveAttribute('href', /^\/co\/perfume\/[a-z0-9-]+\?variante=/);
    await enlaceFicha.click();
    await expect(page).toHaveURL(/\/co\/perfume\/[a-z0-9-]+/);
  });

  test('la primera imagen es prioritaria y las demás son perezosas', async ({ page }) => {
    await page.goto(RUTAS.catalogo('co'));
    const imagenes = page.locator('[data-testid="hero-diapositiva"] img');
    await expect(imagenes.first()).toHaveAttribute('fetchpriority', 'high');
    await expect(imagenes.first()).toHaveClass(/img-esqueleto/);
    const n = await imagenes.count();
    for (let k = 1; k < n; k += 1) await expect(imagenes.nth(k)).toHaveAttribute('loading', 'lazy');
  });

  test('la página 2 del respaldo sin JavaScript no repite el carrusel', async ({ page }) => {
    await page.goto(`${RUTAS.catalogo('co')}?page=2`);
    await expect(page.getByTestId('hero-carrusel')).toHaveCount(0);
  });

  // Capturas de evidencia (375 / 768 / 1280). Solo con E2E_EVIDENCIA=1: `E2E_EVIDENCIA=1 pnpm test:e2e carrusel-catalogo`.
  test('evidencia: capturas del carrusel en celular, tablet y escritorio', async ({ page }, info) => {
    test.skip(!process.env.E2E_EVIDENCIA || info.project.name !== 'escritorio', 'Solo se corre a pedido.');
    const carpeta = path.resolve(__dirname, '../../../../docs/fases/F9-evidencia/carrusel');
    fs.mkdirSync(carpeta, { recursive: true });
    for (const [ancho, alto] of [[375, 812], [768, 1024], [1280, 800]] as const) {
      await page.setViewportSize({ width: ancho, height: alto });
      await page.goto(RUTAS.catalogo('co'));
      await expect(page.getByTestId('hero-carrusel')).toBeVisible();
      await page.waitForLoadState('load');
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(carpeta, `catalogo-${ancho}.png`) });
    }
  });

  test('las anclas de sección que ofrece el panel existen en la tienda', async ({ page }) => {
    await page.goto(`${RUTAS.home('co')}#seccion-categories`);
    await expect(page.locator('#seccion-categories')).toBeAttached();
    await expect(page.locator('#seccion-hero')).toBeAttached();
    await page.goto(RUTAS.catalogo('co'));
    await expect(page.locator('#productos')).toBeAttached();
  });
});
