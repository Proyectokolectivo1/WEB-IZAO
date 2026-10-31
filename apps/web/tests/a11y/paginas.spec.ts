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
import { visiblesEn } from '../support/semilla';

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

type PaginaPublica = { nombre: string; ruta: (p: Pais) => string; listo: boolean; antes?: (page: Page) => Promise<void> };

const PUBLICAS: PaginaPublica[] = [
  { nombre: 'home', ruta: RUTAS.home, listo: true },
  { nombre: 'listado', ruta: (p) => RUTAS.listado(p), listo: true },
  { nombre: 'ficha', ruta: (p) => RUTAS.ficha(p, visiblesEn(p)[0]!.slug), listo: true },
  { nombre: 'búsqueda', ruta: (p) => RUTAS.busqueda(p, 'nomada'), listo: true },
  { nombre: 'carrito abierto', ruta: RUTAS.home, listo: true, antes: async (page) => { await page.getByRole('button', { name: /Abrir tu bolso/ }).click(); } },
  { nombre: 'vista rápida', ruta: (p) => RUTAS.listado(p), listo: true, antes: async (page) => { await page.locator(SEL.botonVistaRapida).first().click(); } },
  { nombre: 'checkout', ruta: (p) => `/${p}/checkout`, listo: true },
];

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
    for (const pagina of PUBLICAS) {
      const definir = pagina.listo ? test : test.fixme;
      definir(`§8.8 ${pagina.nombre} (${pais}) no tiene violaciones WCAG 2.2 AA`, async ({ page, context }) => {
        await fijarPais(context, pais);
        await page.goto(pagina.ruta(pais));
        if (pagina.antes) await pagina.antes(page);
        await auditar(page);
      });
    }

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
              return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
            })
            .map((e) => `${e.tagName}:${(e.textContent ?? '').trim().slice(0, 30)}`),
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
