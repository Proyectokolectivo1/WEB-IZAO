/**
 * Carrusel de banners y su formulario de ajustes, con datos que la tienda de ejemplo no trae: una sola imagen, tiempos
 * distintos y validación del tiempo. Se montan los componentes REALES (`CarruselBanners` → `Hero`/`BannerFijo` y
 * `FormularioCarrusel`) empaquetados con esbuild; el panel completo exige sesión con MFA.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

const RAIZ_WEB = path.resolve(__dirname, '../..');
let bundle = '';

test.beforeAll(async () => {
  const salida = await build({
    entryPoints: [path.join(RAIZ_WEB, 'tests/support/carrusel-entrada.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    tsconfig: path.join(RAIZ_WEB, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'sustitutos-de-next',
        setup(b) {
          const apoyo = path.join(RAIZ_WEB, 'tests/support');
          const mapa: Record<string, string> = {
            'next/link': path.join(apoyo, 'stub-next-link.tsx'),
            'next/navigation': path.join(apoyo, 'stub-next-navigation.ts'),
          };
          b.onResolve({ filter: /.*/ }, (a) => (mapa[a.path] ? { path: mapa[a.path] as string } : null));
        },
      },
    ],
  });
  bundle = salida.outputFiles[0]?.text ?? '';
  expect(bundle.length).toBeGreaterThan(1000);
});

type Cfg = { modo: 'banners' | 'ajustes'; n?: number; segundos?: number };

async function montar(page: Page, cfg: Cfg) {
  await page.clock.install();
  await page.route('**/__carrusel__', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Carrusel</title></head><body><div id="raiz"></div></body></html>' }),
  );
  await page.route('**/media/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.alloc(0) }));
  await page.addInitScript((c) => {
    window.__CARRUSEL__ = c;
  }, cfg);
  await page.goto('/__carrusel__');
  await page.addScriptTag({ content: bundle });
}

const punto = (page: Page, k: number) => page.getByTestId('hero-punto').nth(k);

test.describe('Carrusel de banners', () => {
  test('una sola imagen: sin carrusel, flechas, puntos ni autoavance, y con su enlace', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 1 });
    await expect(page.getByTestId('banner-hero')).toBeVisible();
    await expect(page.getByTestId('hero-carrusel')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Banner 1' })).toHaveAttribute('href', '/co/catalogo#productos');
    // La primera (y única) imagen es la del primer viewport: prioridad alta, sin carga perezosa.
    const img = page.locator('[data-testid="banner-hero"] img');
    await expect(img).toHaveAttribute('fetchpriority', 'high');
    await expect(img).not.toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveClass(/img-esqueleto/);
  });

  test('usa el tiempo del panel (3 s) y no un valor fijo', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 3, segundos: 3 });
    await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
    await page.clock.runFor(2_000);
    await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
    await page.clock.runFor(1_200);
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
    await page.clock.runFor(3_100);
    await expect(punto(page, 2)).toHaveAttribute('aria-current', 'true');
  });

  test('un tiempo fuera de rango se acota (1 s se vuelve 3 s; 99 s, 30 s)', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 2, segundos: 1 });
    await page.clock.runFor(2_000);
    await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
    await page.clock.runFor(1_200);
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
  });

  test('las demás imágenes no se piden hasta que les toca; la primera es prioritaria', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 4, segundos: 3 });
    await expect(page.locator('[data-testid="hero-diapositiva"] img')).toHaveCount(2); // la visible y la siguiente
    const primera = page.locator('[data-testid="hero-diapositiva"] img').first();
    await expect(primera).toHaveAttribute('fetchpriority', 'high');
    await expect(page.locator('[data-testid="hero-diapositiva"] img').nth(1)).toHaveAttribute('loading', 'lazy');
    await page.clock.runFor(3_100);
    await expect(page.locator('[data-testid="hero-diapositiva"] img')).toHaveCount(3);
  });

  test('con el foco en un punto se detiene, y las flechas del teclado cambian de imagen', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 3, segundos: 3 });
    await punto(page, 0).focus();
    await page.clock.runFor(20_000);
    await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(punto(page, 2)).toHaveAttribute('aria-current', 'true');
  });

  test('el botón de pausa detiene el avance y reanudar lo continúa', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 3, segundos: 3 });
    await page.getByRole('button', { name: 'Pausar el carrusel' }).click();
    await page.mouse.move(0, 0);
    await page.clock.runFor(20_000);
    await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Reanudar el carrusel' }).click();
    await page.mouse.move(0, 0);
    await page.clock.runFor(3_200);
    await expect(punto(page, 1)).toHaveAttribute('aria-current', 'true');
  });

  test.describe('con movimiento reducido', () => {
    test.use({ reducedMotion: 'reduce' });
    test('no avanza solo, pero se puede cambiar con los puntos', async ({ page }) => {
      await montar(page, { modo: 'banners', n: 3, segundos: 3 });
      await page.clock.runFor(60_000);
      await expect(punto(page, 0)).toHaveAttribute('aria-current', 'true');
      await punto(page, 2).click();
      await expect(punto(page, 2)).toHaveAttribute('aria-current', 'true');
    });
  });

  test('la imagen activa es la única accesible: las demás van ocultas e inertes', async ({ page }) => {
    await montar(page, { modo: 'banners', n: 3 });
    const diapositivas = page.getByTestId('hero-diapositiva');
    await expect(diapositivas.nth(0)).toHaveAttribute('aria-hidden', 'false');
    await expect(diapositivas.nth(1)).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('hero-carrusel')).toHaveAttribute('aria-roledescription', 'carrusel');
  });
});

test.describe('Formulario de ajustes del carrusel (panel)', () => {
  test('muestra el valor guardado y valida el rango antes de guardar', async ({ page }) => {
    await montar(page, { modo: 'ajustes', segundos: 8 });
    const campo = page.getByLabel(/Segundos entre imágenes/);
    await expect(campo).toHaveValue('8');
    await campo.fill('2');
    await page.getByRole('button', { name: 'Guardar ajustes del carrusel' }).click();
    await expect(page.getByText('Mínimo 3 segundos.')).toBeVisible();
    await campo.fill('45');
    await page.getByRole('button', { name: 'Guardar ajustes del carrusel' }).click();
    await expect(page.getByText('Máximo 30 segundos.')).toBeVisible();
    await campo.fill('4.5');
    await page.getByRole('button', { name: 'Guardar ajustes del carrusel' }).click();
    await expect(page.getByText('Usa un número entero de segundos.')).toBeVisible();
    expect(await page.evaluate(() => window.__GUARDADO__)).toBeUndefined();
  });

  test('guarda segundos válidos y la casilla del catálogo', async ({ page }) => {
    await montar(page, { modo: 'ajustes', segundos: 6 });
    await page.getByLabel(/Segundos entre imágenes/).fill('10');
    await page.getByLabel('Mostrar también arriba del catálogo').uncheck();
    await page.getByRole('button', { name: 'Guardar ajustes del carrusel' }).click();
    await expect(page.getByRole('status')).toContainText('Ajustes del carrusel guardados');
    expect(await page.evaluate(() => window.__GUARDADO__)).toEqual({ country_code: 'CO', interval_seconds: 10, show_in_catalog: false });
  });
});
