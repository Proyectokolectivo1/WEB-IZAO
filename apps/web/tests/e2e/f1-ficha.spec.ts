/**
 * Ficha de producto (§7.6) y su relación con el resto de la tienda. Datos: `support/semilla.ts`.
 * El JSON-LD debe llevar Product + Offer + AggregateRating y NUNCA `brand` (regla 7 de CLAUDE.md).
 */
import { expect, test } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { claveCarrito, RUTAS } from '../support/rutas';
import { visiblesEn } from '../support/semilla';
import { precioVisible, productoConStock, sinEspaciosDuros } from '../support/tienda';

const producto = productoConStock();

for (const pais of ['co', 'ec'] as const) {
  test.describe(`F1 ficha de producto (${pais.toUpperCase()}, §7.6)`, () => {
    test.beforeEach(async ({ context }) => {
      await iniciarSinEstado(context);
      await fijarPais(context, pais);
    });

    test(`§7.6 muestra nombre, presentaciones con su precio (${pais === 'co' ? 'COP sin decimales' : 'USD con dos decimales'}) y los bloques de la ficha`, async ({ page }) => {
      await page.goto(RUTAS.ficha(pais, producto.slug));
      const ficha = page.getByTestId('ficha');
      await expect(ficha.getByRole('heading', { level: 1 })).toHaveText(producto.name);
      const texto = sinEspaciosDuros(await ficha.textContent());
      for (const v of producto.variants) expect(texto).toContain(precioVisible(pais, v.countries[pais]!.price));
      for (const id of ['galeria', 'confianza', 'piramide', 'atributos', 'lista-resenas', 'relacionados', 'boton-iza']) {
        await expect(page.getByTestId(id), id).toBeAttached();
      }
      // El formato del otro país no aparece como precio de esta ficha.
      const otroPais = pais === 'co' ? 'ec' : 'co';
      const otro = precioVisible(otroPais, producto.variants[0]!.countries[otroPais]!.price);
      expect(texto).not.toContain(`$${otro}`);
      expect(texto).not.toContain(`$ ${otro}`);
    });

    test('§7.6 cambiar de presentación marca la elegida y el precio de la compra corresponde a ella', async ({ page }) => {
      await page.goto(RUTAS.ficha(pais, producto.slug));
      const [v0, v1] = producto.variants;
      expect(v0!.countries[pais]!.price).not.toBe(v1!.countries[pais]!.price);
      const compra = page.getByTestId('ficha');
      const chip1 = compra.getByRole('button', { pressed: false }).filter({ hasText: precioVisible(pais, v1!.countries[pais]!.price) }).first();
      await chip1.click();
      await expect(compra.getByRole('button', { pressed: true }).first()).toContainText(precioVisible(pais, v1!.countries[pais]!.price));
    });

    test('§7.6 JSON-LD: Product + Offer + AggregateRating, con moneda del país y sin campo brand', async ({ page }) => {
      await page.goto(RUTAS.ficha(pais, producto.slug));
      const bloques = await page.locator('script[type="application/ld+json"]').allTextContents();
      const datos = bloques.map((b) => JSON.parse(b) as Record<string, any>);
      const p = datos.find((d) => d['@type'] === 'Product');
      expect(p, 'falta el JSON-LD Product').toBeDefined();
      expect(p!.name).toBe(producto.name);
      expect(p).not.toHaveProperty('brand');
      const ofertas = Array.isArray(p!.offers) ? p!.offers : [p!.offers];
      expect(ofertas.length).toBeGreaterThan(0);
      for (const o of ofertas) {
        expect(o['@type']).toBe('Offer');
        expect(o.priceCurrency).toBe(pais === 'co' ? 'COP' : 'USD');
      }
      const esperados = producto.variants.map((v) => (pais === 'co' ? String(v.countries[pais]!.price) : (v.countries[pais]!.price / 100).toFixed(2)));
      expect(ofertas.map((o: { price: string }) => String(o.price)).sort()).toEqual([...esperados].sort());
      expect(JSON.stringify(datos)).not.toMatch(/"brand"/);
    });

    test('regla 7 (§7.6) la ficha no afirma originalidad, autenticidad, certificados ni afiliación con marcas', async ({ page }) => {
      await page.goto(RUTAS.ficha(pais, producto.slug));
      const texto = sinEspaciosDuros(await page.locator('main').innerText());
      expect(texto).not.toMatch(/\b(original(es)?|aut[eé]ntic[oa]s?|certificad[oa]s?|distribuidor(a)? oficial|licenciad[oa])\b/i);
    });

    test('§5.1 canonical al propio país', async ({ page }) => {
      await page.goto(RUTAS.ficha(pais, producto.slug));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/${pais}/perfume/${producto.slug}$`));
    });

    test('§7.6 el botón de Iza abre el chat', async ({ page }) => {
      await page.goto(RUTAS.ficha(pais, producto.slug));
      await page.getByTestId('boton-iza').click();
      await expect(page.getByTestId('panel-iza')).toBeVisible();
    });
  });
}

test.describe('F1 ficha: compra (§7.6, §7.7)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§7.7 agregar desde la ficha abre el bolso con la línea, sube el contador y guarda en localStorage', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    await page.getByTestId('boton-agregar').first().click();
    const bolso = page.getByRole('dialog');
    await expect(bolso).toContainText(producto.name);
    await expect(bolso.getByRole('link', { name: /finalizar compra/i })).toHaveAttribute('href', '/co/checkout');
    await expect(page.getByTestId('contador-carrito')).toHaveText('1');
    const guardado = await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co'));
    expect(JSON.parse(guardado!).lineas).toHaveLength(1);
  });

  test('§7.6 la cantidad no baja de 1 y no pasa del stock disponible', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    const menos = page.getByRole('button', { name: 'Una menos' }).first();
    const mas = page.getByRole('button', { name: 'Una más' }).first();
    await expect(menos).toBeDisabled();
    const stock = producto.variants[0]!.countries.co!.stock;
    for (let i = 1; i < stock; i += 1) await mas.click();
    await expect(mas).toBeDisabled();
    await page.getByTestId('boton-agregar').first().click();
    await expect(page.getByTestId('contador-carrito')).toHaveText(String(stock));
  });

  test('§7.7 agregar dos veces la misma presentación suma la cantidad en una sola línea', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    await page.getByTestId('boton-agregar').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).first().click();
    await page.getByTestId('boton-agregar').first().click();
    await expect(page.getByTestId('contador-carrito')).toHaveText('2');
    const guardado = await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co'));
    const lineas = JSON.parse(guardado!).lineas as { cantidad: number }[];
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.cantidad).toBe(2);
  });

  test('§7.6 móvil: barra fija inferior con precio y botón de agregar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo móvil');
    await page.goto(RUTAS.ficha('co', producto.slug));
    // La barra se oculta mientras el botón principal se ve, y aparece cuando ese botón sale de la pantalla.
    const barra = page.getByTestId('barra-fija');
    await page.getByTestId('boton-agregar').first().scrollIntoViewIfNeeded();
    await expect(barra).not.toBeInViewport();
    await page.mouse.wheel(0, 2500);
    await expect(barra).toBeInViewport();
    expect(sinEspaciosDuros(await barra.textContent())).toContain(precioVisible('co', producto.variants[0]!.countries.co!.price));
    await page.getByTestId('barra-agregar').click();
    await expect(page.getByTestId('contador-carrito')).toHaveText('1');
  });

  test('§7.6 un slug que no existe responde 404 con la página de no encontrado de la tienda', async ({ page }) => {
    const r = await page.goto(RUTAS.ficha('co', 'este-aroma-no-existe-123'));
    expect(r!.status()).toBe(404);
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('§7.6 "También te puede gustar" son productos visibles del país, sin repetir el actual', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    // Se cargan al acercarse a la sección (carga diferida).
    const seccion = page.getByTestId('relacionados');
    await seccion.scrollIntoViewIfNeeded();
    const tarjetas = seccion.locator('[data-testid="tarjeta-producto"]');
    await expect(tarjetas.first()).toBeVisible();
    const slugs = await tarjetas.evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')));
    expect(slugs).not.toContain(producto.slug);
    const visibles = new Set(visiblesEn('co').map((p) => p.slug));
    for (const s of slugs) expect(visibles.has(s!), s!).toBe(true);
  });
});
