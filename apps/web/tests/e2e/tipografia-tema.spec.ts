/**
 * La tipografía del tema (Apariencia) se ve en TODO: tienda y panel, sin fuentes fijas.
 *
 * Método: a `<html>` se le ponen fuentes centinela en `--font-display` / `--font-body` / `--font-mono` (lo mismo que hace el
 * servidor al aplicar la pareja elegida, pero con nombres que ninguna hoja de estilos conoce). Si algún elemento con texto
 * (o campo, botón, opción, texto SVG…) no resuelve a una de las dos centinela, hay una `font-family` fija o un campo que no
 * hereda. Los títulos (h1–h4 en la tienda; h1–h2 del panel) deben ser de `--font-display`; la monoespaciada solo vale en código.
 *
 * Tienda: páginas reales del build de ejemplo (inicio, catálogo, ficha, bolso, checkout, 404, cajón del bolso). Panel: el
 * CSS real y el `CascaronAdmin` real armados en el navegador (la sesión del panel no se puede simular; ver panel-responsive.spec.ts).
 * La prueba unitaria `lib/tipografia/sin-fuentes-fijas.test.ts` cubre el código fuente; esta cubre lo que el navegador resuelve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { RUTAS } from '../support/rutas';
import { PAGINAS_PANEL, htmlPaginaPanel } from '../support/panel-fixtures';
import { agregarDesdeFicha, productoConStock } from '../support/tienda';

const RAIZ_WEB = path.resolve(__dirname, '../..');

const TITULOS = 'ZzTitulos';
const TEXTO = 'ZzTexto';
const MONO = 'ZzMono';

/** Pone las centinela en <html> y devuelve lo que no las sigue. */
async function auditar(page: Page, selectorTitulos: string) {
  return page.evaluate(
    ({ selectorTitulos, TITULOS, TEXTO, MONO }) => {
      const raiz = document.documentElement;
      raiz.style.setProperty('--font-display', `'${TITULOS}', serif`);
      raiz.style.setProperty('--font-body', `'${TEXTO}', sans-serif`);
      raiz.style.setProperty('--font-mono', `'${MONO}', monospace`);
      const primera = (f: string) => f.split(',')[0]!.trim().replace(/["']/g, '');
      const ignorar = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TITLE', 'HEAD', 'BR', 'PATH', 'SVG', 'G', 'RECT', 'CIRCLE', 'LINE', 'POLYLINE', 'USE', 'DEFS']);
      const CODIGO = new Set(['CODE', 'PRE', 'KBD', 'SAMP']);
      const fallos: string[] = [];
      let revisados = 0;
      const it = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT);
      for (let n = it.nextNode() as Element | null; n; n = it.nextNode() as Element | null) {
        const tag = n.tagName.toUpperCase();
        if (ignorar.has(tag) || n.closest('head')) continue;
        const esCampo = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION'].includes(tag);
        const conTexto = [...n.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '') || tag === 'TEXT';
        if (!conTexto && !esCampo) continue;
        revisados += 1;
        const f = primera(getComputedStyle(n).fontFamily);
        const clase = typeof (n as HTMLElement).className === 'string' ? (n as HTMLElement).className.split(/\s+/)[0] : '';
        const descripcion = `${tag.toLowerCase()}${clase ? `.${clase}` : ''} «${(n.textContent ?? '').trim().slice(0, 24)}» → ${f}`;
        if (CODIGO.has(tag) || n.closest('code,pre,kbd,samp') || n.closest('.adm-editor-html') || n.matches('.adm-editor-html')) {
          if (f !== MONO) fallos.push(`código sin --font-mono: ${descripcion}`);
        } else if (n.matches(selectorTitulos)) {
          if (f !== TITULOS) fallos.push(`título sin --font-display: ${descripcion}`);
        } else if (f !== TEXTO && f !== TITULOS) {
          fallos.push(`fuente fija: ${descripcion}`);
        }
      }
      return { revisados, fallos: fallos.slice(0, 20), total: fallos.length };
    },
    { selectorTitulos, TITULOS, TEXTO, MONO },
  );
}

test.describe('tienda sigue las fuentes del tema', () => {
  test.beforeEach(({ page: _p }, info) => {
    test.skip(info.project.name !== 'escritorio', 'el estilo calculado no cambia con el tamaño: basta un proyecto');
  });

  const producto = productoConStock();

  const PAGINAS: { nombre: string; ruta: string }[] = [
    { nombre: 'inicio', ruta: RUTAS.home('co') },
    { nombre: 'catálogo', ruta: RUTAS.catalogo('co') },
    { nombre: 'ficha', ruta: RUTAS.ficha('co', producto.slug) },
    { nombre: 'bolso', ruta: '/co/carrito' },
    { nombre: '404 del país', ruta: '/co/esta-pagina-no-existe' },
    { nombre: '404 sin país', ruta: '/esta-pagina-no-existe' },
  ];

  for (const p of PAGINAS) {
    test(`${p.nombre}: todo el texto sale de --font-display / --font-body`, async ({ page }) => {
      await page.goto(p.ruta);
      await expect(page.locator('h1').first()).toBeVisible();
      const r = await auditar(page, 'h1,h2,h3,h4');
      expect(r.revisados).toBeGreaterThan(3);
      expect(r.fallos).toEqual([]);
    });
  }

  test('cajón del bolso (portal) y checkout con producto en el bolso', async ({ page }) => {
    await agregarDesdeFicha(page, 'co', producto.slug, 1, true);
    expect((await auditar(page, 'h1,h2,h3,h4')).fallos).toEqual([]);
    await page.keyboard.press('Escape');
    await page.goto('/co/checkout');
    await expect(page.locator('form input').first()).toBeVisible();
    const r = await auditar(page, 'h1,h2,h3,h4');
    expect(r.revisados).toBeGreaterThan(20);
    expect(r.fallos).toEqual([]);
  });
});

// --- Panel ------------------------------------------------------------------------------------------------------

const CSS_PANEL = ['admin.css', 'crud.css', 'productos.css', 'metricas.css', 'apariencia.css', 'banners.css']
  .map((f) => fs.readFileSync(path.join(RAIZ_WEB, 'app/admin', f), 'utf8'))
  .join('\n');

let bundle = '';

test.describe('panel sigue las fuentes del tema', () => {
  test.beforeEach(({ page: _p }, info) => {
    test.skip(info.project.name !== 'escritorio', 'el estilo calculado no cambia con el tamaño: basta un proyecto');
  });

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

  for (const pagina of ['login', ...PAGINAS_PANEL] as const) {
    test(`panel «${pagina}»: texto, campos, botones, tablas y gráficos con --font-body; títulos con --font-display; código con --font-mono`, async ({ page }) => {
      await page.setContent(
        `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Panel</title><style>${CSS_PANEL}</style></head><body style="margin:0"><div id="raiz"></div></body></html>`,
      );
      await page.evaluate(
        ({ p, html }) => {
          window.__PANEL__ = { pagina: p, html };
        },
        { p: pagina, html: pagina === 'login' ? '' : htmlPaginaPanel(pagina) },
      );
      await page.addScriptTag({ content: bundle });
      await page.locator('.adm').waitFor();
      // En el panel real los h3/h4 también son de display por la capa base de la tienda; aquí (sin Tailwind) h1 y h2.
      const r = await auditar(page, '.adm h1,.adm h2');
      expect(r.revisados).toBeGreaterThan(3);
      expect(r.fallos).toEqual([]);
    });
  }
});
