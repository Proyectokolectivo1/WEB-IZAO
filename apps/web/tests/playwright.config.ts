/**
 * Playwright de Izao. Se corre desde `apps/web`:
 *   pnpm build        # una vez (o tras cambios): genera .next
 *   pnpm test:e2e     # levanta `next start` + Supabase falso y corre todo
 *
 * Proyectos:
 *  - datos       sin navegador: valida las convenciones de datos del seed.
 *  - escritorio  Chrome de escritorio (puntero fino, hover).
 *  - movil       iPhone 13 (viewport, táctil, UA). Por defecto sobre Chromium (más rápido en CI);
 *                con E2E_WEBKIT=1 usa WebKit real (requiere `playwright install webkit`).
 * Ver tests/LEEME.md.
 */
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DIR_BUILD, DIR_RESULTADOS, DIR_SERVIDOR, entornoDePrueba, PUERTO_SUPABASE_FALSO, PUERTO_WEB, RAIZ_WEB, URL_WEB } from './support/entorno';

const enCI = Boolean(process.env.CI);

if (!process.env.E2E_SIN_COMPROBAR_BUILD && !fs.existsSync(path.join(DIR_SERVIDOR, DIR_BUILD, 'BUILD_ID'))) {
  throw new Error(
    `No hay build de producción en ${DIR_SERVIDOR}/${DIR_BUILD}. Ejecuta "pnpm build" (o, con STORE_DATOS=ejemplo, "pnpm build:e2e") antes de "pnpm test:e2e".`,
  );
}

const navegadorMovil = process.env.E2E_WEBKIT === '1' ? 'webkit' : 'chromium';

export default defineConfig({
  testDir: __dirname,
  testMatch: ['**/*.spec.ts'],
  testIgnore: ['produccion/**'], // F9 contra producción: config aparte (playwright.produccion.config.ts)
  globalSetup: require.resolve('./support/preparar-datos-ejemplo'),
  outputDir: path.join(DIR_RESULTADOS, 'artefactos'),
  fullyParallel: true,
  forbidOnly: enCI,
  retries: enCI ? 1 : 0,
  workers: enCI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(DIR_RESULTADOS, 'informe'), open: 'never' }],
    ['json', { outputFile: path.join(DIR_RESULTADOS, 'resultados.json') }],
  ],
  use: {
    baseURL: URL_WEB,
    // País ya elegido: la ventana de sede (primera visita) no tapa las demás pruebas. Su prueba (`sede-modal.spec.ts`)
    // parte de un contexto vacío con `test.use({ storageState: { cookies: [], origins: [] } })`.
    storageState: { cookies: [{ name: 'country', value: 'co', domain: new URL(URL_WEB).hostname, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'datos', testMatch: ['datos/**/*.spec.ts'] },
    {
      name: 'escritorio',
      testMatch: ['e2e/**/*.spec.ts', 'a11y/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'movil',
      testMatch: ['e2e/**/*.spec.ts', 'a11y/**/*.spec.ts'],
      use: { ...devices['iPhone 13'], defaultBrowserType: navegadorMovil },
    },
  ],
  webServer: [
    {
      // Supabase falso: la tienda nunca habla con Supabase real durante las pruebas.
      command: 'node tests/support/supabase-falso.mjs',
      cwd: RAIZ_WEB,
      url: `http://127.0.0.1:${PUERTO_SUPABASE_FALSO}/__peticiones`,
      reuseExistingServer: !enCI,
      env: { E2E_PUERTO_SUPABASE: String(PUERTO_SUPABASE_FALSO) },
    },
    {
      // `next start` sirve el build con compresión gzip, igual que producción detrás de Nginx.
      command: `node ${path.resolve(RAIZ_WEB, '../../node_modules/next/dist/bin/next')} start -H 127.0.0.1 -p ${PUERTO_WEB}`,
      cwd: DIR_SERVIDOR,
      url: `${URL_WEB}/api/health`,
      reuseExistingServer: !enCI,
      timeout: 120_000,
      env: entornoDePrueba(),
    },
  ],
});
