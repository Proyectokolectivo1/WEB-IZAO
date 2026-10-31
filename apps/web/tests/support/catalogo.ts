/**
 * Ayudas para las pruebas del catálogo (§7). Dependen del contrato de `SEL` y de la forma de
 * `GET /api/catalog` -> `{ items, nextCursor }` (skill izao-catalogo).
 */
import type { Page, Response } from '@playwright/test';
import { TAMANO_LOTE } from './entorno';
import { SEL } from './rutas';

export type ItemCatalogo = { slug: string; name?: string; min_price?: number; in_stock?: boolean; [k: string]: unknown };
export type LoteCatalogo = { items: ItemCatalogo[]; nextCursor: string | null };

/** Registra cada respuesta de `/api/catalog` (en orden) mientras la página la pide. */
export function observarLotes(page: Page): { lotes: LoteCatalogo[]; urls: string[] } {
  const registro = { lotes: [] as LoteCatalogo[], urls: [] as string[] };
  page.on('response', async (r: Response) => {
    if (!r.url().includes('/api/catalog') || r.request().method() !== 'GET') return;
    try {
      registro.lotes.push((await r.json()) as LoteCatalogo);
      registro.urls.push(r.url());
    } catch {
      /* respuesta que no es JSON: la prueba fallará por conteo */
    }
  });
  return registro;
}

/** Baja hasta el mensaje de fin de resultados, esperando cada lote (sin esperas fijas). */
export async function recorrerHastaElFinal(page: Page, maximoPasos = 60): Promise<void> {
  const fin = page.locator(SEL.finResultados);
  for (let paso = 0; paso < maximoPasos; paso += 1) {
    if (await fin.isVisible()) return;
    const antes = await page.locator(SEL.tarjeta).count();
    await page.locator(SEL.centinela).scrollIntoViewIfNeeded().catch(() => undefined);
    await page.mouse.wheel(0, 4000);
    await page
      .waitForFunction(
        ([sel, n, selFin]) =>
          document.querySelectorAll(sel as string).length > (n as number) ||
          document.querySelector(selFin as string) !== null,
        [SEL.tarjeta, antes, SEL.finResultados] as const,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
  }
  throw new Error(`El listado no llegó al final en ${maximoPasos} pasos`);
}

/**
 * Baja como una persona: 500 px cada 100 ms hasta el fin de resultados. Sirve para medir CLS e INP;
 * `recorrerHastaElFinal` salta al centinela (más rápido, para pruebas de contenido).
 */
export async function bajarGradualmenteHastaElFinal(page: Page, maximoPasos = 400): Promise<void> {
  const fin = page.locator(SEL.finResultados);
  for (let paso = 0; paso < maximoPasos; paso += 1) {
    if (await fin.isVisible()) return;
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(100);
  }
  throw new Error(`El listado no llegó al final en ${maximoPasos} pasos graduales`);
}

/** Slugs de las tarjetas que hay en el DOM, en orden. */
export async function slugsEnPantalla(page: Page): Promise<string[]> {
  return page.locator(SEL.tarjeta).evaluateAll((els) => els.map((e) => e.getAttribute('data-slug') ?? ''));
}

export const LOTE = TAMANO_LOTE;

/** Mide el desplazamiento acumulado de diseño (CLS) desde que se llama hasta `leer()`. */
export async function medirCls(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  return () => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

/** En pantallas estrechas el buscador está plegado tras el botón "Buscar"; en escritorio ya está visible. */
export async function abrirBuscador(page: Page): Promise<void> {
  const caja = page.locator(SEL.buscador).first();
  if (await caja.isVisible()) return;
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await caja.waitFor({ state: 'visible' });
}
