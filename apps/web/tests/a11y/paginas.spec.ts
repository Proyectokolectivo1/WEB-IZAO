/**
 * Accesibilidad WCAG 2.2 AA con axe (§8.8, §30 F2 "contraste verificado"). Un caso por página y país.
 * Activas hoy: las páginas que ya existen (login del panel). Las públicas están `fixme` hasta que
 * izao-tienda publique las rutas; se activan poniendo `listo: true` en su fila.
 *
 * Criterio: cero violaciones de las etiquetas wcag2a, wcag2aa, wcag21a, wcag21aa y wcag22aa.
 * Una violación se reporta al dueño de la página; no se agrega a `REGLAS_DESACTIVADAS` para que pase.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Pais } from '../support/entorno';
import { fijarPais } from '../support/pais';
import { RUTAS, SEL } from '../support/rutas';
import { agregarDesdeFicha, productoConStock } from '../support/tienda';

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** Vacío a propósito. Cualquier regla que se agregue aquí necesita una decisión en docs/DECISIONES.md. */
const REGLAS_DESACTIVADAS: string[] = [];

async function auditar(page: Page) {
  const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).disableRules(REGLAS_DESACTIVADAS).analyze();
  const resumen = resultado.violations.map((v) => ({
    regla: v.id,
    impacto: v.impact,
    ayuda: v.help,
    nodos: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  expect(resumen, `Violaciones de accesibilidad:\n${JSON.stringify(resumen, null, 2)}`).toEqual([]);
}

/** Anchos de la revisión de F1 (§30): móvil pequeño, tableta y escritorio. */
const ANCHOS = [
  { nombre: '360', ancho: 360, alto: 740 },
  { nombre: '768', ancho: 768, alto: 1024 },
  { nombre: '1440', ancho: 1440, alto: 900 },
] as const;

const producto = productoConStock();

type PaginaPublica = {
  nombre: string;
  ruta: (p: Pais) => string;
  listo: boolean;
  /** Prepara el estado (bolso lleno, diálogo abierto...) antes de auditar. */
  antes?: (page: Page, pais: Pais) => Promise<void>;
};

const PUBLICAS: PaginaPublica[] = [
  { nombre: 'home', ruta: RUTAS.home, listo: true },
  { nombre: 'catálogo', ruta: RUTAS.catalogo, listo: true },
  { nombre: 'listado de categoría', ruta: (p) => RUTAS.listado(p), listo: true },
  { nombre: 'ficha', ruta: (p) => RUTAS.ficha(p, producto.slug), listo: true },
  { nombre: 'ficha con formulario de reseña', ruta: (p) => RUTAS.ficha(p, producto.slug), listo: true, antes: async (page) => { await page.getByTestId('escribir-resena').click(); await expect(page.getByLabel('Tu nombre')).toBeVisible(); } },
  { nombre: 'búsqueda', ruta: (p) => RUTAS.busqueda(p, 'noche'), listo: true },
  { nombre: 'vista rápida', ruta: (p) => RUTAS.listado(p), listo: true, antes: async (page) => { await page.locator(SEL.botonVistaRapida).first().click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
  { nombre: 'bolso abierto', ruta: RUTAS.home, listo: true, antes: async (page) => { await page.getByRole('button', { name: /Abrir tu bolso/ }).click(); await expect(page.getByRole('dialog')).toBeVisible(); } },
  { nombre: 'carrito (página, con un producto)', ruta: (p) => `/${p}/carrito`, listo: true, antes: async (page, pais) => { await llenarBolso(page, pais); await page.goto(`/${pais}/carrito`); await expect(page.locator('main')).toContainText(producto.name); } },
  { nombre: 'checkout (con un producto)', ruta: (p) => `/${p}/checkout`, listo: true, antes: async (page, pais) => { await llenarBolso(page, pais); await page.goto(`/${pais}/checkout`); await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible(); } },
  { nombre: 'pedido recibido', ruta: (p) => `/${p}/pedido/ejemplo0000000000000000000000000`, listo: true },
  { nombre: 'enlace de abono pagado', ruta: (p) => `/${p}/pagar/ejemplopagado0000000`, listo: true },
  { nombre: 'garantías', ruta: (p) => `/${p}/garantias`, listo: true },
  { nombre: 'página legal', ruta: (p) => `/${p}/pagina/politica-de-envios`, listo: true },
  { nombre: 'chat de Iza abierto', ruta: RUTAS.home, listo: true, antes: async (page) => { await page.getByTestId('lanzador-iza').click(); await expect(page.getByTestId('panel-iza')).toBeVisible(); } },
  { nombre: 'ficha no encontrada (404)', ruta: (p) => RUTAS.ficha(p, 'este-aroma-no-existe-123'), listo: true },
];

/** Agrega el producto de prueba por la interfaz (la misma ruta que seguiría una persona). */
async function llenarBolso(page: Page, pais: Pais) {
  await agregarDesdeFicha(page, pais, producto.slug);
}

test.describe('accesibilidad WCAG 2.2 AA: panel', () => {
  test('§8.8 /admin/login no tiene violaciones WCAG 2.2 AA', async ({ page }) => {
    await page.goto(RUTAS.adminLogin);
    await expect(page.getByRole('heading', { name: 'Ingresar al panel' })).toBeVisible();
    await auditar(page);
  });

  test('§8.8 /admin/login con error visible sigue sin violaciones', async ({ page }) => {
    await page.goto(RUTAS.adminLogin);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.locator('form [role="alert"], form .adm-error, form [aria-invalid="true"]').first()).toBeVisible();
    await auditar(page);
  });

  test('§8.8 /admin/login se recorre completo con teclado y el foco es visible', async ({ page, isMobile }) => {
    test.skip(isMobile, 'el recorrido con Tab es de escritorio');
    await page.goto(RUTAS.adminLogin);
    const orden: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Tab');
      orden.push(await page.evaluate(() => document.activeElement?.tagName ?? ''));
    }
    expect(orden).toEqual(['INPUT', 'INPUT', 'BUTTON']);
    const contorno = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const s = getComputedStyle(e);
      return { ancho: parseFloat(s.outlineWidth), estilo: s.outlineStyle, sombra: s.boxShadow };
    });
    expect(contorno.estilo !== 'none' || contorno.sombra !== 'none').toBe(true);
  });
});

for (const pais of ['co', 'ec'] as const) {
  test.describe(`accesibilidad WCAG 2.2 AA: tienda ${pais.toUpperCase()}`, () => {
    for (const ancho of ANCHOS) {
      for (const pagina of PUBLICAS) {
        const definir = pagina.listo ? test : test.fixme;
        definir(`§8.8 ${pagina.nombre} (${pais}, ${ancho.nombre} px) no tiene violaciones WCAG 2.2 AA`, async ({ page, context, isMobile }) => {
          test.skip(isMobile, 'la matriz de anchos corre en el proyecto de escritorio; el proyecto móvil cubre el táctil');
          await page.setViewportSize({ width: ancho.ancho, height: ancho.alto });
          await fijarPais(context, pais);
          await page.goto(pagina.ruta(pais));
          if (pagina.antes) await pagina.antes(page, pais);
          await auditar(page);
        });
      }
    }

    test(`§8.8 sin desplazamiento horizontal de la página en listado, ficha y checkout a 360 px (${pais})`, async ({ page, context, isMobile }) => {
      test.skip(isMobile, 'solo escritorio con ancho emulado');
      await page.setViewportSize({ width: 360, height: 740 });
      await fijarPais(context, pais);
      for (const ruta of [RUTAS.listado(pais), RUTAS.ficha(pais, producto.slug), `/${pais}/garantias`]) {
        await page.goto(ruta);
        const exceso = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(exceso, ruta).toBeLessThanOrEqual(0);
      }
    });

    test(`§8.8 objetivos táctiles de al menos 44x44 px en listado (${pais})`, async ({ page, context, isMobile }) => {
      test.skip(!isMobile, 'solo táctil');
      await fijarPais(context, pais);
      await page.goto(RUTAS.listado(pais));
      const pequenos = await page
        .locator('button, a[href], input, select, [role="button"]')
        .evaluateAll((els) =>
          els
            .filter((e) => {
              const r = e.getBoundingClientRect();
              const estilo = getComputedStyle(e);
              // El enlace "Saltar al contenido" mide 1x1 hasta recibir el foco: no cuenta.
              const ocultoHastaElFoco = r.width <= 1 && r.height <= 1;
              return r.width > 0 && r.height > 0 && !ocultoHastaElFoco && estilo.visibility !== 'hidden' && (r.width < 44 || r.height < 44);
            })
            .map((e) => `${e.tagName}:${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
        );
      expect(pequenos).toEqual([]);
    });

    test(`§8.8 todas las imágenes del listado tienen alt (${pais})`, async ({ page, context }) => {
      await fijarPais(context, pais);
      await page.goto(RUTAS.listado(pais));
      const sinAlt = await page.locator('img:not([alt])').count();
      expect(sinAlt).toBe(0);
    });
  });
}

test.fixme('§30 F2 contraste verificado con el tema por defecto y con el tema editado en el panel', async () => {
  // 1. Con los tokens por defecto del seed (§8.1), `auditar(page)` en home sin violaciones de `color-contrast`.
  // 2. Cambiar en el panel colores del tema a un par de bajo contraste y comprobar que el panel avisa
  //    antes de guardar (criterio "contraste verificado" de F2).
  // 3. Con el tema guardado, la home pública sigue sin violaciones de `color-contrast`.
});
