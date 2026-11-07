/**
 * Playwright contra PRODUCCIÓN (F9, solo lectura). No levanta servidores ni siembra datos.
 *   cd apps/web && PROD_URL=https://izaoperfumeria.com pnpm exec playwright test -c tests/playwright.produccion.config.ts
 * Navega, mide y captura; no crea pedidos, no paga, no escribe en la base.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: path.join(__dirname, 'produccion'),
  testMatch: ['**/*.spec.ts'],
  outputDir: path.join(__dirname, '.resultados', 'produccion'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: path.join(__dirname, '.resultados', 'produccion', 'resultados.json') }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.PROD_URL || 'https://izaoperfumeria.com',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'off',
  },
});
