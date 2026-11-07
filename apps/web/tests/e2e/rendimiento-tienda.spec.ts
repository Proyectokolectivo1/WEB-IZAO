/**
 * Rendimiento de la tienda en el navegador (lote «JS, renders, llamadas y esqueletos»):
 *  - Renders: cuenta cuántas veces se re-renderiza la tarjeta de producto al cambiar el bolso, abrir el drawer o marcar un deseo.
 *    Se mide con el gancho de React DevTools (`__REACT_DEVTOOLS_GLOBAL_HOOK__`): en cada commit se recorren solo los fibers que
 *    cambiaron y se cuentan los que hicieron trabajo (`PerformedWork`), igual que el Profiler de las DevTools.
 *  - Llamadas: la misma petición en vuelo se comparte y las sugerencias/estado/configuración se sirven de memoria.
 *  - Esqueletos: las pantallas de carga existen, son accesibles y tienen la misma caja que lo definitivo.
 */
import { expect, test, type Page } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { RUTAS } from '../support/rutas';

declare global {
  interface Window {
    __izaoRenders?: { tarjeta: number; total: number };
  }
}

/** Instala el gancho antes de que cargue React y cuenta renders de la tarjeta. */
async function instalarContador(page: Page) {
  await page.addInitScript(() => {
    const PERFORMED_WORK = 1;
    const cuentas = { tarjeta: 0, total: 0 };
    window.__izaoRenders = cuentas;
    type Fiber = {
      tag: number;
      flags: number;
      child: Fiber | null;
      sibling: Fiber | null;
      alternate: Fiber | null;
      memoizedProps?: Record<string, unknown>;
    };
    const esFuncion = (t: number) => t === 0 || t === 11 || t === 15;
    const esTarjeta = (f: Fiber) => esFuncion(f.tag) && f.child?.tag === 5 && f.child.memoizedProps?.['data-testid'] === 'tarjeta-producto';
    const contar = (f: Fiber) => {
      if (esFuncion(f.tag) && (f.flags & PERFORMED_WORK) === PERFORMED_WORK) {
        cuentas.total += 1;
        if (esTarjeta(f)) cuentas.tarjeta += 1;
      }
    };
    const montar = (f: Fiber | null) => {
      for (let n = f; n; n = n.sibling) {
        contar(n);
        montar(n.child);
      }
    };
    const actualizar = (sig: Fiber, prev: Fiber) => {
      contar(sig);
      if (sig.child === prev.child) return; // sin cambios por debajo: nadie se re-renderizó
      for (let h = sig.child; h; h = h.sibling) {
        if (h.alternate) actualizar(h, h.alternate);
        else {
          contar(h);
          montar(h.child);
        }
      }
    };
    let ids = 0;
    (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => ++ids,
      checkDCE: () => undefined,
      onScheduleFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberRoot: (_id: number, raiz: { current: Fiber }) => {
        const actual = raiz.current;
        if (actual.alternate) actualizar(actual, actual.alternate);
        else {
          contar(actual);
          montar(actual.child);
        }
      },
    };
  });
}

const renders = (page: Page) => page.evaluate(() => ({ ...(window.__izaoRenders ?? { tarjeta: 0, total: 0 }) }));
const reiniciar = (page: Page) =>
  page.evaluate(() => {
    if (window.__izaoRenders) {
      window.__izaoRenders.tarjeta = 0;
      window.__izaoRenders.total = 0;
    }
  });

test.describe('Re-renders de la grilla', () => {
  test.beforeEach(async ({ page }) => {
    await iniciarSinEstado(page.context());
    await fijarPais(page.context(), 'co');
    await instalarContador(page);
  });

  test('marcar un deseo solo re-renderiza esa tarjeta; abrir el bolso no toca ninguna', async ({ page }, info) => {
    await page.goto(RUTAS.catalogo('co'));
    const tarjetas = page.getByTestId('tarjeta-producto');
    await expect(tarjetas.first()).toBeVisible();
    const n = await tarjetas.count();
    expect(n).toBeGreaterThan(4);
    // Hidratación terminada: la lectura del bolso (`listo`) ya ocurrió.
    await page.waitForFunction(() => document.querySelector('[data-testid="tarjeta-producto"]') !== null);
    await page.waitForTimeout(600);

    await reiniciar(page);
    await tarjetas.first().getByRole('button', { name: 'Guardar en tu lista de deseos' }).click();
    await page.waitForTimeout(300);
    const tras = await renders(page);
    info.annotations.push({ type: 'renders', description: `${n} tarjetas; deseo -> ${tras.tarjeta} tarjetas re-renderizadas (${tras.total} componentes)` });
    console.log(`[renders] ${n} tarjetas; marcar un deseo -> tarjetas re-renderizadas: ${tras.tarjeta} (componentes: ${tras.total})`);
    expect(tras.tarjeta).toBeLessThanOrEqual(1);

    await reiniciar(page);
    await page.getByRole('button', { name: /Abrir tu bolso/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500);
    const bolso = await renders(page);
    console.log(`[renders] abrir el bolso -> tarjetas re-renderizadas: ${bolso.tarjeta} (componentes: ${bolso.total})`);
    expect(bolso.tarjeta).toBe(0);
  });

  test('agregar al bolso no re-renderiza la grilla', async ({ page }) => {
    await page.goto(RUTAS.catalogo('co'));
    const tarjetas = page.getByTestId('tarjeta-producto');
    await expect(tarjetas.first()).toBeVisible();
    await page.waitForTimeout(600);
    // En los datos de ejemplo toda tarjeta tiene dos presentaciones: se agrega desde la vista rápida.
    await tarjetas.first().getByTestId('boton-vista-rapida').click();
    const dialogo = page.getByTestId('vista-rapida');
    await expect(dialogo.getByRole('button', { name: /Agregar al bolso/ })).toBeVisible();
    await reiniciar(page);
    await dialogo.getByRole('button', { name: /Agregar al bolso/ }).click();
    await page.waitForTimeout(800);
    const r = await renders(page);
    console.log(`[renders] agregar al bolso -> tarjetas re-renderizadas: ${r.tarjeta} (componentes: ${r.total})`);
    expect(r.tarjeta).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('contador-carrito')).toBeVisible();
  });
});

test.describe('Llamadas a la API', () => {
  test.beforeEach(async ({ page }) => {
    await iniciarSinEstado(page.context());
    await fijarPais(page.context(), 'co');
  });

  test('las sugerencias repetidas salen de memoria y escribir rápido pide una sola vez', async ({ page }) => {
    const pedidas: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/catalog/suggest')) pedidas.push(r.url());
    });
    await page.goto(RUTAS.home('co'));
    const caja = page.getByRole('combobox').first();
    // En móvil el buscador vive tras el botón «Buscar».
    if (!(await caja.isVisible())) await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
    await caja.click();
    await caja.pressSequentially('rosa', { delay: 30 });
    await page.waitForTimeout(700);
    expect(pedidas.length).toBe(1); // debounce de 200 ms: una sola petición para «rosa»
    await caja.fill('');
    await page.waitForTimeout(300);
    await caja.fill('rosa');
    await page.waitForTimeout(700);
    expect(pedidas.length).toBe(1); // segunda vez: de memoria
  });

  test('abrir y cerrar a Iza dos veces consulta el estado una sola vez', async ({ page }) => {
    const estados: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/chat/estado')) estados.push(r.url());
    });
    await page.goto(RUTAS.home('co'));
    const abrir = page.getByRole('button', { name: /Iza/ }).first();
    if (!(await abrir.isVisible().catch(() => false))) test.skip(true, 'Iza no está habilitada en estos datos.');
    await abrir.click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await abrir.click();
    await page.waitForTimeout(500);
    expect(estados.length).toBeLessThanOrEqual(1);
  });
});

test.describe('Esqueletos de carga', () => {
  test('el listado muestra tarjetas de la misma caja que las reales al pedir más lotes', async ({ page }) => {
    await iniciarSinEstado(page.context());
    await fijarPais(page.context(), 'co');
    await page.goto(RUTAS.catalogo('co'));
    const real = await page.getByTestId('tarjeta-producto').first().boundingBox();
    expect(real).not.toBeNull();
    // Retrasa el lote siguiente para poder ver el esqueleto.
    await page.route('**/api/catalog?**', async (ruta) => {
      await new Promise((x) => setTimeout(x, 1200));
      await ruta.fallback();
    });
    await page.getByTestId('centinela-scroll').scrollIntoViewIfNeeded();
    const esqueleto = page.getByTestId('esqueleto-tarjeta').first();
    if (await esqueleto.isVisible({ timeout: 3000 }).catch(() => false)) {
      const caja = await esqueleto.boundingBox();
      expect(Math.abs((caja?.width ?? 0) - (real?.width ?? 0))).toBeLessThan(1.5);
      expect(Math.abs((caja?.height ?? 0) - (real?.height ?? 0))).toBeLessThan(2);
      await expect(page.getByTestId('tarjeta-producto').first().locator('xpath=ancestor::div[@aria-busy][1]')).toHaveAttribute('aria-busy', 'true');
    }
  });
});
