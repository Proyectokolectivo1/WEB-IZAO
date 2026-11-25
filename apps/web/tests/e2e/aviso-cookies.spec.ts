/**
 * Aviso de cookies y consentimiento del Meta Pixel (§23.2): opt-in estricto.
 *
 * Sin decisión (o con «Rechazar») NO se pide `fbevents.js` ni se envía nada. «Aceptar» lo carga sin recargar la página y envía el
 * `PageView` de la página actual. La decisión persiste en la cookie `izao_consent` (12 meses, SameSite=Lax) y se cambia desde el
 * enlace «Cookies» del pie. El aviso no tapa el botón de WhatsApp ni Iza, no mueve el diseño (CLS) y no tiene violaciones de axe.
 *
 * El servidor por defecto (puerto 3100) no trae Pixel: esta prueba levanta su propio `next start` sobre el mismo build con
 * `EJEMPLO_PIXEL` (un Pixel distinto por país) y `EJEMPLO_WHATSAPP`. Los pedidos a Meta se interceptan: no sale nada a la red.
 */
import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DIR_SERVIDOR, entornoDePrueba, URL_WEB, type Pais } from '../support/entorno';
import { RUTAS } from '../support/rutas';

const PIXEL: Record<Pais, string> = { co: '111111111111111', ec: '222222222222222' };
const EJEMPLO_PIXEL = JSON.stringify(PIXEL);
const EJEMPLO_WHATSAPP = JSON.stringify({ co: { numero: '573001112233' }, ec: { numero: '593991112233' } });
const PUERTO_BASE = 3170;
const AVISO = '[data-testid="aviso-cookies"]';
const COOKIE = 'izao_consent';

// Sin decisión de cookies (las demás pruebas ya la traen): solo el país elegido.
test.use({
  storageState: {
    cookies: [{ name: 'country', value: 'co', domain: new URL(URL_WEB).hostname, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
    origins: [],
  },
});
test.describe.configure({ mode: 'serial' });

let servidor: ChildProcess | null = null;
let base = '';

test.beforeAll(async () => {
  const puerto = PUERTO_BASE + test.info().project.name.length;
  base = `http://127.0.0.1:${puerto}`;
  const next = path.resolve(DIR_SERVIDOR, '../../node_modules/next/dist/bin/next');
  servidor = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(puerto)], {
    cwd: DIR_SERVIDOR,
    env: { ...process.env, ...entornoDePrueba(), EJEMPLO_PIXEL, EJEMPLO_WHATSAPP },
    stdio: 'ignore',
  });
  const limite = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* aún arrancando */
    }
    if (Date.now() > limite) throw new Error('El servidor del aviso de cookies no arrancó');
    await new Promise((r) => setTimeout(r, 500));
  }
});

test.afterAll(() => {
  servidor?.kill();
});

/** Intercepta Meta (sin red) y cuenta los pedidos a `facebook`. */
async function vigilarMeta(page: Page): Promise<string[]> {
  const pedidos: string[] = [];
  await page.route(/(connect\.facebook\.net|www\.facebook\.com)/, (route) => {
    pedidos.push(route.request().url());
    return route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  return pedidos;
}

const cola = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as { fbq?: { queue?: ArrayLike<unknown>[] } }).fbq;
    return f?.queue ? f.queue.map((a) => Array.from(a)) : null;
  });
const cookieDeConsentimiento = async (context: BrowserContext) => (await context.cookies(base)).find((c) => c.name === COOKIE);
const aceptar = (page: Page) => page.locator(AVISO).getByRole('button', { name: 'Aceptar', exact: true });
const rechazar = (page: Page) => page.locator(AVISO).getByRole('button', { name: 'Rechazar', exact: true });
const caja = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
type Caja = { x: number; y: number; width: number; height: number };
const seSolapan = (a: Caja, b: Caja) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('sin decisión: el aviso sale y no se pide nada a Meta ni existe fbq', async ({ page }) => {
  const pedidos = await vigilarMeta(page);
  await page.goto(`${base}${RUTAS.home('co')}`);
  await expect(page.locator(AVISO)).toBeVisible();
  await expect(page.locator(AVISO)).toHaveAccessibleName('Aviso de cookies');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  expect(pedidos).toEqual([]);
  expect(await cola(page)).toBeNull();
  // Ni script de Meta ni imagen noscript en el HTML.
  const html = await (await page.request.get(`${base}${RUTAS.home('co')}`)).text();
  expect(html).not.toMatch(/fbevents|facebook\.com\/tr/);
});

test('Aceptar y Rechazar pesan lo mismo y son táctiles', async ({ page }) => {
  await page.goto(`${base}${RUTAS.home('co')}`);
  await expect(page.locator(AVISO)).toBeVisible();
  const a = (await aceptar(page).boundingBox())!;
  const r = (await rechazar(page).boundingBox())!;
  expect(Math.abs(a.width - r.width)).toBeLessThanOrEqual(2);
  expect(a.height).toBeGreaterThanOrEqual(44);
  expect(r.height).toBeGreaterThanOrEqual(44);
  expect(await aceptar(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await rechazar(page).evaluate((el) => getComputedStyle(el).backgroundColor));
});

test('Rechazar: persiste, no carga Meta y no vuelve a preguntar', async ({ page, context }) => {
  const pedidos = await vigilarMeta(page);
  await page.goto(`${base}${RUTAS.home('co')}`);
  await rechazar(page).click();
  await expect(page.locator(AVISO)).toHaveCount(0);
  const c = await cookieDeConsentimiento(context);
  expect(c?.value).toMatch(/^v1\.a0\.m0\.t\d+$/);
  expect(c?.sameSite).toBe('Lax');
  expect((c?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(60 * 60 * 24 * 360);
  await page.reload();
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  await expect(page.locator(AVISO)).toHaveCount(0);
  expect(pedidos).toEqual([]);
  expect(await cola(page)).toBeNull();
});

test('Aceptar: carga el Pixel del país sin recargar y envía el PageView de esta página', async ({ page, context }) => {
  const pedidos = await vigilarMeta(page);
  await page.goto(`${base}${RUTAS.home('co')}`);
  await page.waitForLoadState('load');
  // Marca en la página: si hubiera una recarga, desaparecería.
  await page.evaluate(() => ((window as unknown as { __sinRecarga?: boolean }).__sinRecarga = true));
  await aceptar(page).click();
  await expect(page.locator(AVISO)).toHaveCount(0);
  await expect.poll(() => pedidos.some((u) => u.includes('fbevents.js'))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __sinRecarga?: boolean }).__sinRecarga)).toBe(true);
  const q = (await cola(page))!;
  expect(q).toEqual(expect.arrayContaining([['init', PIXEL.co], ['trackSingle', PIXEL.co, 'PageView']]));
  expect(JSON.stringify(q)).not.toContain(PIXEL.ec);
  expect((await cookieDeConsentimiento(context))?.value).toMatch(/^v1\.a1\.m1\.t\d+$/);
  // Siguiente visita: ya aceptó, el Pixel arranca solo.
  await page.reload();
  await expect.poll(async () => (await cola(page))?.some((l) => l[0] === 'trackSingle')).toBe(true);
  await expect(page.locator(AVISO)).toHaveCount(0);
});

test('Ecuador usa su propio Pixel', async ({ page, context }) => {
  await context.addCookies([{ name: 'country', value: 'ec', url: base }]);
  await vigilarMeta(page);
  await page.goto(`${base}${RUTAS.home('ec')}`);
  await aceptar(page).click();
  await expect.poll(async () => (await cola(page))?.some((l) => l[0] === 'init')).toBe(true);
  const q = JSON.stringify(await cola(page));
  expect(q).toContain(PIXEL.ec);
  expect(q).not.toContain(PIXEL.co);
});

test('Preferencias: solo analítica no carga Meta; el pie permite cambiar y retirar avisa que se recargue', async ({ page, context }) => {
  const pedidos = await vigilarMeta(page);
  await page.goto(`${base}${RUTAS.home('co')}`);
  await page.locator(AVISO).getByRole('button', { name: 'Preferencias' }).click();
  const d = page.getByRole('dialog', { name: 'Preferencias de cookies' });
  await expect(d).toBeVisible();
  await expect(d.getByRole('switch')).toHaveCount(2);
  await d.getByRole('switch', { name: 'Analítica' }).check();
  await d.getByRole('button', { name: 'Guardar mi selección' }).click();
  await expect(d).toHaveCount(0);
  expect((await cookieDeConsentimiento(context))?.value).toMatch(/^v1\.a1\.m0\.t\d+$/);
  await page.waitForTimeout(1000);
  expect(pedidos).toEqual([]);

  // Desde el pie: activa publicidad sin recargar y la página queda con el Pixel.
  await page.getByTestId('enlace-cookies').click();
  await page.getByRole('dialog', { name: 'Preferencias de cookies' }).getByRole('switch', { name: 'Publicidad' }).check();
  await page.getByRole('dialog', { name: 'Preferencias de cookies' }).getByRole('button', { name: 'Guardar mi selección' }).click();
  await expect.poll(() => pedidos.some((u) => u.includes('fbevents.js'))).toBe(true);

  // Retirar: deja de enviar, avisa que el cambio completo aplica al recargar y, al recargar, ya no se pide nada.
  await page.getByTestId('enlace-cookies').click();
  await page.getByRole('dialog', { name: 'Preferencias de cookies' }).getByRole('button', { name: 'Rechazar todas' }).click();
  await expect(page.locator(AVISO)).toContainText('recarga la página');
  expect(await page.evaluate(() => (window as unknown as { __izaoPixelId?: string }).__izaoPixelId)).toBeUndefined();
  expect((await cola(page))!.at(-1)).toEqual(['consent', 'revoke']);
  const antes = pedidos.length;
  await page.getByRole('button', { name: 'Recargar ahora' }).click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  expect(pedidos.length).toBe(antes);
  expect(await cola(page)).toBeNull();
});

test('el pie trae el enlace «Cookies» y el aviso enlaza la política de datos si está publicada', async ({ page }) => {
  await page.goto(`${base}${RUTAS.home('co')}`);
  await expect(page.getByTestId('enlace-cookies')).toBeVisible();
  await expect(page.getByTestId('enlace-cookies')).toHaveAccessibleName(/Cookies/);
  const politica = page.locator(AVISO).getByRole('link', { name: 'Más información' });
  if (await politica.count()) await expect(politica).toHaveAttribute('href', /^\/co\/pagina\//);
});

for (const ancho of [360, 768, 1440]) {
  test(`no tapa el botón de WhatsApp ni Iza y no mueve el diseño (${ancho} px)`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.setViewportSize({ width: ancho, height: ancho >= 1024 ? 900 : 780 });
    await page.goto(`${base}${RUTAS.home('co')}`);
    await expect(page.locator(AVISO)).toBeVisible();
    await expect(page.getByTestId('boton-whatsapp')).toBeVisible();
    await expect(page.getByTestId('lanzador-iza')).toBeVisible();
    const aviso = await caja(page, AVISO);
    expect(aviso.x).toBeGreaterThanOrEqual(0);
    expect(aviso.x + aviso.width).toBeLessThanOrEqual(ancho);
    // Los botones suben con una transición corta: se espera a que terminen antes de medir.
    await expect.poll(async () => seSolapan(aviso, await caja(page, '[data-testid="boton-whatsapp"]'))).toBe(false);
    await expect.poll(async () => seSolapan(aviso, await caja(page, '[data-testid="lanzador-iza"]'))).toBe(false);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.1);
    // Al decidir, los botones vuelven a su sitio.
    const ySin = (await caja(page, '[data-testid="boton-whatsapp"]')).y;
    await rechazar(page).click();
    await expect(page.locator(AVISO)).toHaveCount(0);
    await expect.poll(async () => (await caja(page, '[data-testid="boton-whatsapp"]')).y).toBeGreaterThan(ySin);
  });
}

test('teclado: el aviso es lo primero en el orden de foco, con foco visible y sin atrapar', async ({ page }) => {
  await page.goto(`${base}${RUTAS.home('co')}`);
  await expect(page.locator(AVISO)).toBeVisible();
  // Lo primero que alcanza el teclado es el aviso: [enlace a la política si existe] → Aceptar → Rechazar → Preferencias.
  const visitados: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    visitados.push(await page.evaluate(() => (document.activeElement?.closest('[data-testid="aviso-cookies"]') ? (document.activeElement.textContent ?? '').trim() : 'FUERA')));
  }
  expect(visitados).not.toContain('FUERA');
  expect(visitados.slice(-3)).toEqual(['Aceptar', 'Rechazar', 'Preferencias']);
  await expect(page.locator(AVISO).getByRole('button', { name: 'Preferencias' })).toBeFocused();
  expect(await page.locator(AVISO).getByRole('button', { name: 'Preferencias' }).evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
  // Preferencias: foco atrapado y Esc cierra devolviendo el foco.
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog', { name: 'Preferencias de cookies' });
  await expect(d).toBeVisible();
  await expect(d).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(page.locator(AVISO).getByRole('button', { name: 'Preferencias' })).toBeFocused();
});

test('accesibilidad (axe): aviso y preferencias sin violaciones', async ({ page }) => {
  await page.goto(`${base}${RUTAS.home('co')}`);
  await expect(page.locator(AVISO)).toBeVisible();
  const aviso = await new AxeBuilder({ page }).include(AVISO).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(aviso.violations, JSON.stringify(aviso.violations.map((v) => v.id))).toEqual([]);
  await page.locator(AVISO).getByRole('button', { name: 'Preferencias' }).click();
  const d = page.getByRole('dialog', { name: 'Preferencias de cookies' });
  await expect(d).toBeVisible();
  const prefs = await new AxeBuilder({ page }).include('[data-testid="preferencias-cookies"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(prefs.violations, JSON.stringify(prefs.violations.map((v) => v.id))).toEqual([]);
});
