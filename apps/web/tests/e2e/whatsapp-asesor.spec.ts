/**
 * Botón flotante «Hablar con un asesor» (WhatsApp): número y mensaje por país (`country_settings`), oculto sin número,
 * sin solaparse con Iza ni con la barra fija de compra de la ficha, ausente del panel y del pago, y sin violaciones de axe.
 *
 * El servidor de pruebas por defecto (puerto 3100) no trae número de asesor: ahí se prueba el botón AUSENTE. Para el resto
 * esta prueba levanta su propio `next start` sobre el mismo build con `EJEMPLO_WHATSAPP` (un número distinto por país),
 * el equivalente en ejemplo de lo que se guarda en el panel (Pagos y países › WhatsApp del asesor).
 */
import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DIR_SERVIDOR, entornoDePrueba, URL_WEB, type Pais } from '../support/entorno';
import { fijarPais } from '../support/pais';
import { RUTAS } from '../support/rutas';
import { productoConStock } from '../support/tienda';

const NUMEROS: Record<Pais, string> = { co: '573001112233', ec: '593991112233' };
const MENSAJE_CO = 'Hola, quiero un aroma para regalar.';
const EJEMPLO_WHATSAPP = JSON.stringify({ co: { numero: NUMEROS.co, mensaje: MENSAJE_CO }, ec: { numero: NUMEROS.ec } });
const PUERTO_BASE = 3150;
const BOTON = '[data-testid="boton-whatsapp"]';
const producto = productoConStock();

let servidor: ChildProcess | null = null;
let base = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const puerto = PUERTO_BASE + test.info().project.name.length; // un puerto por proyecto (escritorio / movil)
  base = `http://127.0.0.1:${puerto}`;
  const next = path.resolve(DIR_SERVIDOR, '../../node_modules/next/dist/bin/next');
  servidor = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(puerto)], {
    cwd: DIR_SERVIDOR,
    env: { ...process.env, ...entornoDePrueba(), EJEMPLO_WHATSAPP },
    stdio: 'ignore',
  });
  const limite = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* aún arrancando */
    }
    if (Date.now() > limite) throw new Error('El servidor de WhatsApp no arrancó');
    await new Promise((r) => setTimeout(r, 500));
  }
});

test.afterAll(() => {
  servidor?.kill();
});

const caja = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
type Caja = { x: number; y: number; width: number; height: number };
const seSolapan = (a: Caja, b: Caja) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('sin número de asesor el botón no se muestra (servidor por defecto)', async ({ page, context }) => {
  for (const pais of ['co', 'ec'] as Pais[]) {
    await fijarPais(context, pais);
    await page.goto(`${URL_WEB}${RUTAS.home(pais)}`);
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator(BOTON)).toHaveCount(0);
  }
});

for (const pais of ['co', 'ec'] as Pais[]) {
  test(`/${pais}: enlace wa.me con el número y el mensaje del país, accesible y táctil`, async ({ page, context }) => {
    await fijarPais(context, pais);
    await page.goto(`${base}${RUTAS.home(pais)}`);
    const boton = page.locator(BOTON);
    await expect(boton).toHaveCount(1);
    const href = new URL((await boton.getAttribute('href'))!);
    expect(href.origin + href.pathname).toBe(`https://wa.me/${NUMEROS[pais]}`);
    // /co trae mensaje propio; /ec usa el de por defecto de la tienda (distinto y sin afirmar originalidad).
    if (pais === 'co') expect(href.searchParams.get('text')).toBe(MENSAJE_CO);
    else expect(href.searchParams.get('text')).toMatch(/ayuden a elegir una fragancia/);
    expect(href.searchParams.get('text') ?? '').not.toMatch(/original|aut[eé]ntic|certificad/i);
    await expect(boton).toHaveAttribute('target', '_blank');
    await expect(boton).toHaveAttribute('rel', /noopener/);
    await expect(boton).toHaveAccessibleName(/asesor por WhatsApp/);
    const c = (await boton.boundingBox())!;
    expect(c.width).toBeGreaterThanOrEqual(44);
    expect(c.height).toBeGreaterThanOrEqual(44);
    // Foco visible por teclado (anillo de tinta de 2 px).
    await boton.focus();
    await expect(boton).toBeFocused();
    expect(await boton.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    expect(await boton.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
  });
}

test('el número es distinto en /co y en /ec', async ({ page, context }) => {
  const href: Record<string, string> = {};
  for (const pais of ['co', 'ec'] as Pais[]) {
    await fijarPais(context, pais);
    await page.goto(`${base}${RUTAS.home(pais)}`);
    href[pais] = (await page.locator(BOTON).getAttribute('href'))!;
  }
  expect(href['co']).not.toBe(href['ec']);
});

test('respeta prefers-reduced-motion', async ({ page, context }) => {
  await fijarPais(context, 'co');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}${RUTAS.home('co')}`);
  expect(await page.locator(BOTON).evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator(BOTON).evaluate((el) => getComputedStyle(el).transitionProperty)).not.toBe('none');
});

for (const ancho of [360, 768, 1440]) {
  test(`no se solapa con Iza ni con el botón de filtros (${ancho} px)`, async ({ page, context }) => {
    await fijarPais(context, 'co');
    await page.setViewportSize({ width: ancho, height: ancho >= 1024 ? 900 : 780 });
    for (const ruta of [RUTAS.home('co'), RUTAS.listado('co')]) {
      await page.goto(`${base}${ruta}`);
      await expect(page.locator(BOTON)).toBeVisible();
      await expect(page.getByTestId('lanzador-iza')).toBeVisible();
      const wa = await caja(page, BOTON);
      expect(seSolapan(wa, await caja(page, '[data-testid="lanzador-iza"]'))).toBe(false);
      const filtros = page.getByTestId('abrir-filtros');
      if (await filtros.isVisible()) expect(seSolapan(wa, (await filtros.boundingBox())!)).toBe(false);
      // Dentro de la pantalla.
      expect(wa.x).toBeGreaterThanOrEqual(0);
      expect(wa.y + wa.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
  });
}

test('en la ficha, en móvil, queda por encima de la barra fija de compra', async ({ page, context }) => {
  await fijarPais(context, 'co');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${base}${RUTAS.ficha('co', producto.slug)}`);
  const barra = page.getByTestId('barra-fija');
  await page.mouse.wheel(0, 2500);
  await expect(barra).toBeInViewport();
  await expect(page.locator(BOTON)).toBeVisible();
  const wa = await caja(page, BOTON);
  const b = (await barra.boundingBox())!;
  expect(wa.y + wa.height).toBeLessThanOrEqual(b.y);
  expect(seSolapan(wa, b)).toBe(false);
  expect(seSolapan(wa, await caja(page, '[data-testid="lanzador-iza"]'))).toBe(false);
});

test('no aparece en el pago ni en el panel', async ({ page, context }) => {
  await fijarPais(context, 'co');
  await page.goto(`${base}/co/checkout`);
  await expect(page.getByTestId('checkout').or(page.locator('main')).first()).toBeVisible();
  await expect(page.locator(BOTON)).toHaveCount(0);
  await page.goto(`${base}${RUTAS.adminLogin}`);
  await expect(page.locator(BOTON)).toHaveCount(0);
});

for (const pais of ['co', 'ec'] as Pais[]) {
  test(`axe: sin violaciones WCAG 2.2 AA con el botón en /${pais}`, async ({ page, context }) => {
    await fijarPais(context, pais);
    await page.goto(`${base}${RUTAS.home(pais)}`);
    await expect(page.locator(BOTON)).toBeVisible();
    await page.evaluate(async () => {
      const finitas = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.race([Promise.all(finitas.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3_000))]);
    });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => ({ regla: v.id, nodos: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}
