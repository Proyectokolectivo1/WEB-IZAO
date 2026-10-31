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

const CARGAS = 100;
const EN_PARALELO = 10;

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
  // Cuando React recupera el error re-renderiza el layout y la página puede quedar sin <title> (axe: document-title).
  if (!(await page.title())) errores.push('la página quedó sin <title>');
  await context.close();
  return errores;
}

const ESCENARIOS = [
  ['/co', false],
  ['/co', true],
  ['/co/carrito', false],
] as const;

// Un solo test que recorre los escenarios uno tras otro: la carrera necesita carga, pero no tanta como para agotar la máquina.
test(`hidratación: ${CARGAS} cargas por escenario (home, home con localStorage bloqueado, carrito) sin errores de hidratación`, async ({ browser, isMobile }) => {
  test.skip(isMobile, 'la carrera se provoca con muchas pestañas a la vez; basta el proyecto de escritorio');
  test.setTimeout(300_000);
  const resumen: Record<string, string[]> = {};
  for (const [ruta, bloqueado] of ESCENARIOS) {
    const errores: string[] = [];
    for (let i = 0; i < CARGAS; i += EN_PARALELO) {
      const lote = await Promise.all(Array.from({ length: EN_PARALELO }, () => cargar(browser, ruta, bloqueado)));
      errores.push(...lote.flat());
    }
    resumen[`${ruta} (${bloqueado ? 'localStorage bloqueado' : 'almacenamiento normal'}): ${errores.length} errores en ${CARGAS} cargas`] = [...new Set(errores)];
  }
  const conErrores = Object.fromEntries(Object.entries(resumen).filter(([clave]) => !clave.includes(': 0 errores')));
  expect(conErrores, JSON.stringify(resumen, null, 1)).toEqual({});
});
