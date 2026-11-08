/**
 * «Agregar al bolso» y «Comprar ahora» en todas las superficies de compra: tarjeta, vista rápida, ficha y barra fija
 * de móvil. «Comprar ahora» suma el producto (cantidad elegida) y va directo a `/{país}/checkout` sin abrir el bolso.
 * Con varias presentaciones sin elegir, la tarjeta abre la vista rápida en vez de agregar a ciegas; sin existencias,
 * todo queda deshabilitado.
 */
import { expect, test, type Page } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { claveCarrito, RUTAS, SEL } from '../support/rutas';
import { visiblesEn } from '../support/semilla';
import { productoConStock } from '../support/tienda';

const producto = productoConStock();
const agotado = visiblesEn('co').find((p) => p.variants.every((v) => (v.countries.co?.stock ?? 0) === 0));

const COMPRAR = '[data-testid="boton-comprar-ahora"]';

async function lineasGuardadas(page: Page): Promise<{ cantidad: number; slug: string }[]> {
  const guardado = await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co'));
  return guardado ? (JSON.parse(guardado) as { lineas: { cantidad: number; slug: string }[] }).lineas : [];
}

/** Los datos de ejemplo traen siempre dos presentaciones: aquí se simula un aroma de una sola, en el listado y en su ficha. */
async function simularUnaPresentacion(page: Page) {
  await page.route(/\/co\/(categoria|buscar|catalogo)/, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const r = await route.fetch();
    const html = (await r.text()).replace(/variant_count\\*"\s*:\s*2/g, (m) => m.replace('2', '1'));
    const headers = { ...r.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    await route.fulfill({ status: r.status(), headers, body: html });
  });
  await page.route('**/api/catalog/product**', async (route) => {
    const r = await route.fetch();
    const ficha = (await r.json()) as { variants: unknown[] };
    ficha.variants = [ficha.variants[0]];
    await route.fulfill({ response: r, json: ficha });
  });
}

test.describe('Comprar ahora', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('ficha: Comprar ahora suma la cantidad elegida y va al checkout sin abrir el bolso', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    const ficha = page.getByTestId('ficha');
    await expect(ficha.getByTestId('boton-agregar').first()).toBeEnabled();
    await expect(ficha.locator(COMPRAR).first()).toHaveText('Comprar ahora');
    await ficha.getByRole('button', { name: 'Una más' }).click();
    await ficha.locator(COMPRAR).first().click();
    await expect(page).toHaveURL(/\/co\/checkout$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await lineasGuardadas(page)).toMatchObject([{ slug: producto.slug, cantidad: 2 }]);
    await expect(page.locator('main')).toContainText(producto.name);
  });

  test('ficha: Agregar al bolso sigue abriendo el bolso', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    await page.getByTestId('ficha').getByTestId('boton-agregar').first().click();
    await expect(page.getByRole('dialog')).toContainText(producto.name);
    await expect(page).toHaveURL(/\/co\/perfume\//);
  });

  test('ficha: sin existencias, Agregar y Comprar ahora están deshabilitados y dicen Agotado', async ({ page }) => {
    test.skip(!agotado, 'los datos no traen un aroma agotado');
    await page.goto(RUTAS.ficha('co', agotado!.slug));
    const ficha = page.getByTestId('ficha');
    await expect(ficha.getByTestId('boton-agregar').first()).toBeDisabled();
    await expect(ficha.getByTestId('boton-agregar').first()).toHaveText(/Agotado/);
    await expect(ficha.locator(COMPRAR).first()).toBeDisabled();
    expect(await lineasGuardadas(page)).toHaveLength(0);
  });

  test('móvil: la barra fija ofrece Agregar y Comprar ahora', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo móvil');
    await page.goto(RUTAS.ficha('co', producto.slug));
    const barra = page.getByTestId('barra-fija');
    await page.getByTestId('boton-agregar').first().scrollIntoViewIfNeeded();
    await expect(barra).not.toBeInViewport();
    await page.mouse.wheel(0, 2500);
    await expect(barra).toBeInViewport();
    await expect(barra.getByTestId('barra-agregar')).toBeVisible();
    await expect(barra.getByTestId('barra-comprar-ahora')).toHaveText('Comprar ahora');
    // Objetivo táctil de al menos 44 px.
    for (const id of ['barra-agregar', 'barra-comprar-ahora']) {
      const caja = (await barra.getByTestId(id).boundingBox())!;
      expect(caja.height).toBeGreaterThanOrEqual(44);
    }
    await barra.getByTestId('barra-comprar-ahora').click();
    await expect(page).toHaveURL(/\/co\/checkout$/);
    expect(await lineasGuardadas(page)).toMatchObject([{ slug: producto.slug, cantidad: 1 }]);
  });

  test('tarjeta con varias presentaciones: Comprar ahora abre la vista rápida y no agrega a ciegas', async ({ page }) => {
    await page.goto(RUTAS.listado('co'));
    const tarjeta = page.locator(SEL.tarjeta).first();
    await expect(tarjeta.locator(COMPRAR)).toBeVisible();
    await tarjeta.locator(COMPRAR).click();
    const vista = page.locator(SEL.vistaRapida);
    await expect(vista).toBeVisible();
    await expect(page).toHaveURL(/\/co\/categoria\//);
    expect(await lineasGuardadas(page)).toHaveLength(0);
    // Con las presentaciones a la vista, la vista rápida compra directo.
    await vista.locator(COMPRAR).click();
    await expect(page).toHaveURL(/\/co\/checkout$/);
    expect(await lineasGuardadas(page)).toHaveLength(1);
  });

  test('vista rápida: Agregar al bolso abre el bolso y Comprar ahora va al checkout', async ({ page }) => {
    await page.goto(RUTAS.listado('co'));
    await page.locator(SEL.tarjeta).first().locator(SEL.botonVistaRapida).click();
    await page.locator(SEL.vistaRapida).locator(SEL.botonAgregar).click();
    await expect(page.locator(SEL.contadorCarrito)).toHaveText('1');
    await expect(page.getByRole('dialog', { name: /bolso/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator(SEL.vistaRapida)).toHaveCount(0);

    const segunda = page.locator(SEL.tarjeta).nth(1);
    await segunda.locator(SEL.botonVistaRapida).click();
    await page.locator(SEL.vistaRapida).locator(COMPRAR).click();
    await expect(page).toHaveURL(/\/co\/checkout$/);
    // Los datos de ejemplo repiten el id de variante entre aromas: se suma por unidades, no por líneas.
    const unidades = (await lineasGuardadas(page)).reduce((n, l) => n + l.cantidad, 0);
    expect(unidades).toBe(2);
  });

  test('tarjeta de una sola presentación: Agregar suma y se queda; Comprar ahora suma y va al checkout', async ({ page }) => {
    await simularUnaPresentacion(page);
    await page.goto(RUTAS.listado('co'));
    const tarjeta = page.locator(SEL.tarjeta).first();
    await expect(tarjeta.locator(SEL.botonAgregar)).toHaveText('Agregar al bolso');
    await tarjeta.locator(SEL.botonAgregar).click();
    await expect(page.locator(SEL.contadorCarrito)).toHaveText('1');
    await expect(page).toHaveURL(/\/co\/categoria\//);

    await tarjeta.locator(COMPRAR).click();
    await expect(page).toHaveURL(/\/co\/checkout$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const lineas = await lineasGuardadas(page);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.cantidad).toBe(2);
  });

  test('tarjeta agotada: los dos botones están deshabilitados y no tocan el bolso', async ({ page }) => {
    test.skip(!agotado, 'los datos no traen un aroma agotado');
    await page.goto(RUTAS.busqueda('co', agotado!.name));
    const tarjeta = page.locator(`${SEL.tarjeta}[data-slug="${agotado!.slug}"]`);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.locator(SEL.botonAgregar)).toBeDisabled();
    await expect(tarjeta.locator(SEL.botonAgregar)).toHaveText('Agotado');
    await expect(tarjeta.locator(COMPRAR)).toBeDisabled();
    expect(await lineasGuardadas(page)).toHaveLength(0);
  });

  test('tarjeta: ambos botones miden 44 px y el nombre sigue abriendo la ficha', async ({ page }) => {
    await page.goto(RUTAS.listado('co'));
    const tarjeta = page.locator(SEL.tarjeta).first();
    for (const sel of [SEL.botonAgregar, COMPRAR]) {
      const caja = (await tarjeta.locator(sel).boundingBox())!;
      expect(caja.height).toBeGreaterThanOrEqual(44);
    }
    await expect(tarjeta.locator(COMPRAR)).toHaveAccessibleName(/^Comprar ahora: /);
    await tarjeta.getByRole('heading').getByRole('link').click();
    await expect(page).toHaveURL(/\/co\/perfume\//);
  });
});
