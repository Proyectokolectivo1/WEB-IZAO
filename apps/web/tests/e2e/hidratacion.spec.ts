/**
 * Hidratación de React sin errores (§27 calidad; regla de no regresión). Diagnóstico del error #418 intermitente
 * («el HTML del servidor no coincide con el del cliente») visto en `§7.7 con localStorage bloqueado`.
 *
 * Hallazgos (build de producción, datos de ejemplo, 2026-10-31):
 *  - NO depende de `localStorage` bloqueado: ocurre igual con el almacenamiento normal.
 *  - Ocurre en páginas distintas que comparten el layout `app/[country]/layout.tsx` (home, carrito, garantías, páginas legales),
 *    ~2-6 % de las cargas con varias pestañas a la vez; no se reproduce con `next dev` (más lento, sin la carrera).
 *  - React recupera re-renderizando TODO `#tema-pais`, así que el fallo está en el layout (Header/Buscador/CarritoProvider/Footer/
 *    LanzadorIza), no en la página. Justo antes del error React hidrata el `<input type="search">` del Buscador (cambian `type` y `value`).
 * Estas pruebas cargan la misma ruta muchas veces EN PARALELO (la carrera necesita carga) y exigen cero errores de página.
 */
import { expect, test, type Browser } from '@playwright/test';
import { URL_WEB } from '../support/entorno';

const CARGAS = 80;
const EN_PARALELO = 20;

async function cargar(browser: Browser, ruta: string, bloqueado: boolean): Promise<string[]> {
  const context = await browser.newContext({ baseURL: URL_WEB, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'country', value: 'co', url: URL_WEB }]);
  if (bloqueado) {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('bloqueado', 'SecurityError');
        },
      });
    });
  }
  const page = await context.newPage();
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message.slice(0, 120)));
  await page.goto(ruta);
  await page.waitForTimeout(1_200);
  await context.close();
  return errores;
}

for (const [ruta, bloqueado] of [
  ['/co', false],
  ['/co', true],
  ['/co/carrito', false],
] as const) {
  test(`hidratación: ${CARGAS} cargas de ${ruta} (${bloqueado ? 'localStorage bloqueado' : 'almacenamiento normal'}) sin errores de hidratación`, async ({ browser, isMobile }) => {
    test.skip(isMobile, 'la carrera se provoca con muchas pestañas a la vez; basta el proyecto de escritorio');
    test.setTimeout(120_000);
    const errores: string[] = [];
    for (let i = 0; i < CARGAS; i += EN_PARALELO) {
      const lote = await Promise.all(Array.from({ length: EN_PARALELO }, () => cargar(browser, ruta, bloqueado)));
      errores.push(...lote.flat());
    }
    expect(errores, `${errores.length} errores en ${CARGAS} cargas`).toEqual([]);
  });
}
