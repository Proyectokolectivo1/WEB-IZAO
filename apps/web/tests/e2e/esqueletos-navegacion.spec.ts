/**
 * Esqueletos de carga del lado del cliente (sin `loading.tsx`): navegación suave a la búsqueda, recarga del listado
 * al cambiar el orden y comportamiento intacto del 404 de la ficha.
 */
import { expect, test } from '@playwright/test';
import { abrirBuscador } from '../support/catalogo';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { RUTAS, SEL } from '../support/rutas';

test.describe('Esqueletos de carga (cliente)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('buscar desde el encabezado muestra el esqueleto del listado y lo quita al llegar los resultados', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    // Deja pasar el reposo de la página para que el código de los esqueletos ya esté bajado.
    await page.waitForLoadState('networkidle');
    await page.route(/\/co\/buscar/, async (ruta) => {
      if (ruta.request().headers()['rsc']) await new Promise((x) => setTimeout(x, 1500));
      await ruta.fallback();
    });
    await abrirBuscador(page);
    const caja = page.locator(SEL.buscador).first();
    await caja.fill('cuero');
    await caja.press('Enter');

    const esqueleto = page.getByTestId('esqueleto-navegacion');
    await expect(esqueleto).toBeVisible();
    // Decorativo para lectores de pantalla; el aviso va en una región de estado y la zona principal queda «ocupada».
    await expect(esqueleto).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#contenido')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Buscando los aromas' })).toBeAttached();

    await expect(page).toHaveURL(/\/co\/buscar\?q=cuero/);
    await expect(page.getByTestId('total-resultados')).toBeVisible();
    await expect(esqueleto).toHaveCount(0);
    await expect(page.locator('#contenido')).not.toHaveAttribute('aria-busy', 'true');
  });

  test('la ficha inexistente sigue respondiendo 404', async ({ page }) => {
    const r = await page.goto('/co/perfume/no-existe-xyz');
    expect(r?.status()).toBe(404);
  });
});
