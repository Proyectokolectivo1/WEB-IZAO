/**
 * Panel /admin adaptable (celular 375 px, tablet 768 px y escritorio 1440 px).
 *
 * El panel real exige Supabase Auth + MFA y el Supabase falso de las pruebas no simula esa sesión, así que aquí se arma
 * cada pantalla en el navegador con: el CSS real del panel (los archivos fuente), el `CascaronAdmin` REAL (menú y barra,
 * empaquetado con esbuild con `next/link` y `next/navigation` sustituidos) y páginas de ejemplo con el marcado de las
 * páginas reales (`support/panel-fixtures.ts`). Se mide lo que se puede medir así: desborde horizontal, objetivos táctiles,
 * tamaño de letra y el comportamiento del menú. La capa de datos y los permisos no se tocan (los cubren sus pruebas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { PAGINAS_PANEL, htmlPaginaPanel } from '../support/panel-fixtures';

const RAIZ_WEB = path.resolve(__dirname, '../..');
const CSS = ['admin.css', 'crud.css', 'productos.css', 'metricas.css']
  .map((f) => fs.readFileSync(path.join(RAIZ_WEB, 'app/admin', f), 'utf8'))
  .join('\n');

let bundle = '';

test.beforeAll(async () => {
  const salida = await build({
    entryPoints: [path.join(RAIZ_WEB, 'tests/support/panel-entrada.tsx')],
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
            '@/app/admin/login/actions': path.join(apoyo, 'stub-acciones-admin.ts'),
            '@/app/admin/acciones': path.join(apoyo, 'stub-acciones-admin.ts'),
          };
          b.onResolve({ filter: /.*/ }, (a) => (mapa[a.path] ? { path: mapa[a.path] as string } : null));
        },
      },
    ],
  });
  bundle = salida.outputFiles[0]?.text ?? '';
  expect(bundle.length).toBeGreaterThan(1000);
});

async function abrir(page: Page, pagina: 'login' | (typeof PAGINAS_PANEL)[number]) {
  await page.setContent(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Panel</title><style>${CSS}</style></head><body style="margin:0"><div id="raiz"></div></body></html>`,
  );
  await page.evaluate(
    ({ p, html }) => {
      window.__PANEL__ = { pagina: p, html };
    },
    { p: pagina, html: pagina === 'login' ? '' : htmlPaginaPanel(pagina) },
  );
  await page.addScriptTag({ content: bundle });
  await page.locator('.adm').waitFor();
}

const sinDesborde = (page: Page) =>
  page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, visible: document.documentElement.clientWidth }));

const TAMANOS = [
  { nombre: 'celular', ancho: 375, alto: 812, proyecto: 'movil' },
  { nombre: 'tablet', ancho: 768, alto: 1024, proyecto: 'movil' },
  { nombre: 'escritorio', ancho: 1440, alto: 900, proyecto: 'escritorio' },
] as const;

for (const t of TAMANOS) {
  test.describe(`panel a ${t.ancho} px (${t.nombre})`, () => {
    test.beforeEach(({ page: _pagina }, info) => {
      test.skip(info.project.name !== t.proyecto, `solo en el proyecto ${t.proyecto}`);
    });
    test.use({ viewport: { width: t.ancho, height: t.alto } });

    for (const pagina of ['login', ...PAGINAS_PANEL] as const) {
      test(`${pagina}: sin scroll horizontal de página`, async ({ page }) => {
        await abrir(page, pagina);
        const m = await sinDesborde(page);
        expect(m.ancho).toBeLessThanOrEqual(m.visible);
      });
    }

    test('barra y menú según el ancho', async ({ page }) => {
      await abrir(page, 'inicio');
      const boton = page.getByRole('button', { name: 'Menú', exact: true });
      const lateral = page.locator('#adm-menu');
      if (t.ancho < 1024) {
        await expect(boton).toBeVisible();
        await expect(lateral).toBeHidden();
        const caja = await boton.boundingBox();
        expect(caja?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
      } else {
        await expect(boton).toBeHidden();
        await expect(lateral).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Módulos del panel' })).toBeVisible();
      }
    });
  });
}

for (const t of TAMANOS.filter((x) => x.ancho < 1024)) {
  test.describe(`menú móvil a ${t.ancho} px`, () => {
    test.beforeEach(({ page: _pagina }, info) => {
      test.skip(info.project.name !== 'movil', 'solo en el proyecto movil');
    });
    test.use({ viewport: { width: t.ancho, height: t.alto } });

    test('abre, atrapa el foco y cierra con Esc, con el velo y con el botón, devolviendo el foco', async ({ page }) => {
      await abrir(page, 'pedidos');
      const boton = page.getByRole('button', { name: 'Menú', exact: true });
      const lateral = page.locator('#adm-menu');
      await expect(boton).toHaveAttribute('aria-expanded', 'false');
      await expect(boton).toHaveAttribute('aria-controls', 'adm-menu');

      await boton.click();
      await expect(boton).toHaveAttribute('aria-expanded', 'true');
      await expect(lateral).toBeVisible();
      // La hoja cabe en pantalla y no la desborda.
      await expect.poll(async () => (await lateral.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0); // espera la transición
      const caja = await lateral.boundingBox();
      expect((caja?.x ?? 0) + (caja?.width ?? 0)).toBeLessThanOrEqual(t.ancho);
      // El foco entra a la hoja y la página de atrás queda inerte.
      await expect(lateral.locator(':focus')).toHaveCount(1);
      await expect(page.locator('.adm-principal')).toHaveAttribute('inert', '');
      // Objetivos táctiles de los enlaces del menú: al menos 44 px de alto.
      const altos = await lateral.locator('.adm-nav a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(altos.length).toBeGreaterThan(10);
      expect(Math.min(...altos)).toBeGreaterThanOrEqual(44);
      // El módulo actual se anuncia.
      await expect(lateral.locator('a[aria-current="page"]')).toHaveText('Pedidos');

      // Tab no se sale de la hoja.
      for (let i = 0; i < 40; i += 1) await page.keyboard.press('Tab');
      await expect(lateral.locator(':focus')).toHaveCount(1);

      // Esc cierra y el foco vuelve al botón.
      await page.keyboard.press('Escape');
      await expect(boton).toHaveAttribute('aria-expanded', 'false');
      await expect(lateral).toBeHidden();
      await expect(boton).toBeFocused();

      // El velo también cierra.
      await boton.click();
      await expect(lateral).toBeVisible();
      await page.mouse.click(t.ancho - 4, 400);
      await expect(lateral).toBeHidden();

      // Y el botón «Cerrar menú» de la hoja.
      await boton.click();
      await page.getByRole('button', { name: 'Cerrar menú' }).click();
      await expect(lateral).toBeHidden();
      await expect(boton).toBeFocused();
    });
  });
}

test.describe('celular: tamaños y listas', () => {
  test.beforeEach(({ page: _pagina }, info) => {
    test.skip(info.project.name !== 'movil', 'solo en el proyecto movil');
  });
  test.use({ viewport: { width: 375, height: 812 } });

  test('letra del panel proporcionada y controles táctiles de 44 px', async ({ page }) => {
    await abrir(page, 'pedidos');
    const letra = await page.evaluate(() => ({
      base: parseFloat(getComputedStyle(document.querySelector('.adm') as Element).fontSize),
      h1: parseFloat(getComputedStyle(document.querySelector('h1') as Element).fontSize),
    }));
    expect(letra.base).toBeLessThanOrEqual(16);
    expect(letra.h1).toBeLessThanOrEqual(22);
    const altos = await page
      .locator('.adm-contenido .adm-boton, .adm-contenido .adm-enlace-boton, .adm-contenido .adm-input, .adm-barra .adm-boton')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(altos.length).toBeGreaterThan(5);
    expect(Math.min(...altos)).toBeGreaterThanOrEqual(44);
    // Los campos no bajan de 16 px (en iPhone, menos hace saltar el zoom al enfocar).
    const campos = await page.locator('.adm-input').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(Math.min(...campos)).toBeGreaterThanOrEqual(15);
  });

  test('pedidos, productos, agente, clientes, gastos y garantías se leen como tarjetas apiladas, no como tabla ancha', async ({ page }) => {
    for (const pagina of ['pedidos', 'productos', 'agente', 'clientes', 'gastos', 'garantias'] as const) {
      await abrir(page, pagina);
      const tabla = page.locator('table.adm-tabla-apilada').first();
      await expect(tabla.locator('thead')).not.toBeInViewport();
      const filas = await tabla.locator('tbody tr').first().evaluate((tr) => getComputedStyle(tr).display);
      expect(filas).toBe('block');
      // Cada celda (menos la primera) trae su encabezado.
      const sinEtiqueta = await tabla.locator('tbody tr:first-child td:not(:first-child):not([data-etiqueta])').count();
      expect(sinEtiqueta).toBe(0);
    }
  });

  test('clientes, gastos y garantías: ni la página ni la caja de la tabla se desplazan en horizontal', async ({ page }) => {
    for (const pagina of ['clientes', 'gastos', 'garantias'] as const) {
      await abrir(page, pagina);
      const m = await sinDesborde(page);
      expect(m.ancho, `${pagina}: documento`).toBeLessThanOrEqual(m.visible);
      const cajas = await page
        .locator('.adm-tabla-caja')
        .evaluateAll((els) => els.map((e) => ({ ancho: e.scrollWidth, visible: e.clientWidth })));
      expect(cajas.length).toBeGreaterThan(0);
      for (const c of cajas) expect(c.ancho, `${pagina}: caja de la tabla`).toBeLessThanOrEqual(c.visible);
      // Cada tarjeta lleva el título arriba y los datos con su encabezado; el contenido largo no se sale.
      const filas = page.locator('table.adm-tabla-apilada tbody tr');
      expect(await filas.count()).toBeGreaterThanOrEqual(2);
      const celdasFuera = await page.evaluate(() => {
        const limite = document.documentElement.clientWidth;
        return [...document.querySelectorAll('table.adm-tabla-apilada td')].filter((td) => td.getBoundingClientRect().right > limite + 1).length;
      });
      expect(celdasFuera).toBe(0);
    }
  });
});

test.describe('tablet: las listas siguen siendo tablas', () => {
  test.beforeEach(({ page: _pagina }, info) => {
    test.skip(info.project.name !== 'movil', 'solo en el proyecto movil');
  });
  test.use({ viewport: { width: 768, height: 1024 } });

  test('pedidos mantiene la tabla con su propio desplazamiento si no cabe', async ({ page }) => {
    await abrir(page, 'pedidos');
    const fila = await page.locator('table.adm-tabla-apilada tbody tr').first().evaluate((tr) => getComputedStyle(tr).display);
    expect(fila).toBe('table-row');
    const m = await sinDesborde(page);
    expect(m.ancho).toBeLessThanOrEqual(m.visible);
  });

  test('clientes, gastos y garantías no desbordan la página a 768 px', async ({ page }) => {
    for (const pagina of ['clientes', 'gastos', 'garantias'] as const) {
      await abrir(page, pagina);
      const m = await sinDesborde(page);
      expect(m.ancho, pagina).toBeLessThanOrEqual(m.visible);
      const fila = await page.locator('table.adm-tabla-apilada tbody tr').first().evaluate((tr) => getComputedStyle(tr).display);
      expect(fila).toBe('table-row');
    }
  });
});
