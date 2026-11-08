/**
 * Ventana de elección de sede (primera visita), cambio de país sin errores y pie de Ecuador.
 * Parte de un contexto vacío (sin cookie `country`): las demás pruebas ya traen el país elegido desde la configuración.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { RAIZ_REPO, URL_WEB } from '../support/entorno';
import { RUTAS } from '../support/rutas';

test.use({ storageState: { cookies: [], origins: [] } });

const dialogo = (page: Page) => page.getByRole('dialog', { name: '¿Desde dónde nos visitas?' });
const cookiePais = async (page: Page) => (await page.context().cookies(URL_WEB)).find((c) => c.name === 'country')?.value;
const DIR_CAPTURAS = path.join(RAIZ_REPO, 'docs/fases/F9-evidencia/sede');
/** La ventana sale tras la primera interacción: se simula una tecla neutra hasta que aparece (o por tiempo, si no se toca nada). */
async function abrirConInteraccion(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Shift');
    await expect(dialogo(page)).toBeVisible({ timeout: 800 });
  }).toPass({ timeout: 10_000 });
}
/** Tras una interacción, la ventana saldría en ~0,4 s: si no aparece en 1,5 s, es que no sale. */
async function noSale(page: Page, ruta?: string): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(1500);
  await expect(dialogo(page), ruta).toHaveCount(0);
}
const dentroDelDialogo = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

test.describe('Ventana de sede', () => {
  test('primera visita: sale, atrapa el foco y no se cierra sin elegir (sin CLS)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(RUTAS.home('co'));
    const d = dialogo(page);
    await expect(d).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.02);
    await expect(d).toHaveAttribute('aria-modal', 'true');
    await expect(d.getByRole('button', { name: /Colombia/ })).toBeVisible();
    await expect(d.getByRole('button', { name: /Ecuador/ })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Cerrar' })).toHaveCount(0);

    // El foco arranca en el diálogo y el Tab no se escapa de él.
    await expect(d).toBeFocused();
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dentroDelDialogo(page)).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await dentroDelDialogo(page)).toBe(true);

    // Ni Esc ni clic fuera cierran.
    await page.keyboard.press('Escape');
    await page.mouse.click(4, 4);
    await expect(d).toBeVisible();
  });

  for (const [ancho, alto] of [[375, 740], [1280, 800]] as const) {
    test(`capturas de la ventana a ${ancho} px (solo con E2E_CAPTURAS=1)`, async ({ page }, info) => {
      test.skip(process.env.E2E_CAPTURAS !== '1' || info.project.name !== 'escritorio', 'solo para generar la evidencia');
      await page.setViewportSize({ width: ancho, height: alto });
      await page.goto(RUTAS.home('co'));
      await abrirConInteraccion(page);
      await page.waitForTimeout(700);
      fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
      await page.screenshot({ path: path.join(DIR_CAPTURAS, `sede-${ancho}.png`) });
    });
  }

  test('elegir Colombia lo recuerda (cookie y localStorage) y no vuelve a salir', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    await abrirConInteraccion(page);
    await dialogo(page).getByRole('button', { name: /Colombia/ }).click();
    await expect(dialogo(page)).toBeHidden();
    expect(await cookiePais(page)).toBe('co');
    expect(await page.evaluate(() => localStorage.getItem('izao:sede'))).toBe('co');
    await page.reload();
    await noSale(page);
  });

  test('elegir Ecuador lleva a /ec sin errores, con la cookie guardada', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    await abrirConInteraccion(page);
    await dialogo(page).getByRole('button', { name: /Ecuador/ }).click();
    await expect(page).toHaveURL(/\/ec(\?|$)/);
    expect(await cookiePais(page)).toBe('ec');
    await expect(page.locator('footer')).toBeVisible();
    await noSale(page);
    expect(await page.evaluate(() => localStorage.getItem('izao:sede'))).toBe('ec');
  });

  test('con teclado: Enter sobre Ecuador elige y navega', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    await abrirConInteraccion(page);
    await expect(dialogo(page)).toBeFocused();
    await page.keyboard.press('Tab'); // Colombia
    await page.keyboard.press('Tab'); // Ecuador
    await expect(dialogo(page).getByRole('button', { name: /Ecuador/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/ec(\?|$)/);
  });

  test('con movimiento reducido también sale y se puede elegir', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(RUTAS.home('ec'));
    await abrirConInteraccion(page);
    await dialogo(page).getByRole('button', { name: /Ecuador/ }).click();
    await expect(dialogo(page)).toBeHidden();
    expect(await cookiePais(page)).toBe('ec');
  });

  test('el HTML del servidor no trae la ventana (los robots ven el contenido) y no sale en pago ni seguimiento', async ({ page, request }) => {
    const html = await (await request.get(RUTAS.home('co'))).text();
    expect(html).not.toContain('modal-sede');
    expect(html).toContain('<footer');
    for (const ruta of ['/co/pedido/abc', '/co/pagar/abc', '/co/checkout']) {
      await page.goto(ruta);
      await noSale(page, ruta);
    }
  });

  test('ya elegido: no sale, y el botón de la cabecera la abre y Esc la cierra', async ({ page, context }) => {
    await context.addCookies([{ name: 'country', value: 'co', url: URL_WEB }]);
    await page.goto(RUTAS.home('co'));
    await noSale(page);
    const boton = page.getByTestId('boton-sede');
    if (await boton.first().isVisible()) {
      await boton.first().click();
    } else {
      await page.getByRole('button', { name: 'Menú' }).click();
      await page.getByRole('dialog').getByTestId('boton-sede').click();
    }
    const d = dialogo(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole('button', { name: 'Cerrar' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
  });
});

test.describe('Cambio de país y pie de Ecuador', () => {
  test('cambiar-pais redirige con ruta relativa (detrás de Nginx el host interno no sirve)', async ({ request }) => {
    const r = await request.get('/co/cambiar-pais?a=ec&ruta=%2Fpagina%2Fpolitica-de-envios', { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers()['location']).toMatch(/^\/ec(\/|$)/);
    expect(r.headers()['set-cookie']).toContain('country=ec');
    const mala = await request.get('/co/cambiar-pais?a=xx', { maxRedirects: 0 });
    expect(mala.headers()['location']).toBe('/');
  });

  test('todos los enlaces del pie de /ec responden bien', async ({ page, request }) => {
    await page.context().addCookies([{ name: 'country', value: 'ec', url: URL_WEB }]);
    await page.goto('/ec');
    const enlaces = await page.locator('footer a[href^="/ec"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    expect(enlaces.length).toBeGreaterThan(0);
    for (const href of new Set(enlaces)) {
      const r = await request.get(href);
      expect(r.status(), href).toBeLessThan(400);
    }
  });

  test('una política que solo existe en Colombia avisa con calidez en Ecuador, y un enlace inexistente sigue siendo 404', async ({ page, request }) => {
    await page.context().addCookies([{ name: 'country', value: 'ec', url: URL_WEB }]);
    await page.goto('/ec/pagina/solo-colombia');
    await expect(page.getByTestId('pagina-en-preparacion')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estamos preparando esta información para Ecuador');
    expect((await request.get('/co/pagina/solo-colombia')).status()).toBe(200);
    expect((await request.get('/ec/pagina/no-existe-en-ninguno')).status()).toBe(404);
  });
});

test.describe('Caché de la API del catálogo', () => {
  test('lleva ETag y responde 304 a If-None-Match', async ({ request }) => {
    const url = `${RUTAS.apiCatalogo}?country=co`;
    const a = await request.get(url);
    expect(a.status()).toBe(200);
    const etag = a.headers()['etag'];
    expect(etag).toBeTruthy();
    expect(a.headers()['cache-control']).toContain('max-age=30');
    expect(a.headers()['cache-control']).toContain('stale-while-revalidate');
    const b = await request.get(url, { headers: { 'If-None-Match': etag! } });
    expect(b.status()).toBe(304);
  });
});
