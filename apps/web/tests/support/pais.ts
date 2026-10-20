/**
 * Utilidades para fijar el país y limpiar el estado del navegador (§5.1).
 * Cada prueba de Playwright ya corre en un contexto aislado; estas funciones sirven para
 * partir de un estado conocido dentro de la misma prueba (p. ej. cambiar de país).
 */
import type { BrowserContext, Page } from '@playwright/test';
import { URL_WEB, type Pais } from './entorno';

/** Cookie que decide el redireccionamiento de `/` (§5.1). */
export const COOKIE_PAIS = 'country';

/** Fija la cookie `country` en el contexto, antes de navegar. */
export async function fijarPais(context: BrowserContext, pais: Pais): Promise<void> {
  await context.addCookies([{ name: COOKIE_PAIS, value: pais, url: URL_WEB }]);
}

/** Borra cookies y almacenamiento del origen actual (localStorage, sessionStorage). */
export async function limpiarEstado(page: Page): Promise<void> {
  await page.context().clearCookies();
  if (page.url().startsWith('http')) {
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* almacenamiento bloqueado: nada que limpiar */
      }
    });
  }
}

/** Arranca cada página del contexto con el almacenamiento vacío (equivale a una visita nueva). */
export async function iniciarSinEstado(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__e2e_iniciado')) {
        localStorage.clear();
        sessionStorage.setItem('__e2e_iniciado', '1');
      }
    } catch {
      /* ignorar */
    }
  });
}
