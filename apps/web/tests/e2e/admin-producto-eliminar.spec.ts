/**
 * Eliminar productos desde el panel (D-055), en el navegador: el botón «Eliminar» pide una confirmación clara (explica que
 * con pedidos se archiva y sin pedidos se borra para siempre, y que MasterShop no se toca), se puede cancelar sin llamar
 * al servidor y, al confirmar, llama una sola vez a la acción. Montamos el `BotonConfirmar` y el texto reales; la Server
 * Action se sustituye porque el panel completo exige sesión (ver `tests/support/producto-eliminar-entrada.tsx`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

const RAIZ_WEB = path.resolve(__dirname, '../..');
const CSS = ['admin.css', 'crud.css', 'productos.css']
  .map((f) => fs.readFileSync(path.join(RAIZ_WEB, 'app/admin', f), 'utf8'))
  .join(' ');
let bundle = '';

test.beforeAll(async () => {
  const salida = await build({
    entryPoints: [path.join(RAIZ_WEB, 'tests/support/producto-eliminar-entrada.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    tsconfig: path.join(RAIZ_WEB, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  bundle = salida.outputFiles[0]?.text ?? '';
  expect(bundle.length).toBeGreaterThan(1000);
});

async function montar(page: Page, cfg: { estado?: 'active' | 'archived'; resultado: 'eliminado' | 'archivado' | 'error' }) {
  await page.route('**/__eliminar__', (r) =>
    r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Productos</title><style>${CSS}</style></head><body><div id="raiz"></div></body></html>` }),
  );
  await page.addInitScript(
    (c) => {
      window.__ELIMINAR__ = { nombre: 'Oud Nocturno', estado: c.estado ?? 'active', resultado: c.resultado, llamadas: [] };
    },
    cfg,
  );
  await page.goto('/__eliminar__');
  await page.addScriptTag({ content: bundle });
}

const llamadas = (page: Page) => page.evaluate(() => window.__ELIMINAR__?.llamadas ?? []);

test.describe('Eliminar producto en la lista', () => {
  test('pide confirmación con el texto claro y cancelar no llama al servidor', async ({ page }) => {
    await montar(page, { resultado: 'eliminado' });
    await page.getByRole('button', { name: 'Eliminar' }).click();

    const dialogo = page.getByRole('alertdialog', { name: 'Eliminar' });
    await expect(dialogo).toContainText('Vas a eliminar «Oud Nocturno»');
    await expect(dialogo).toContainText('Si ya tiene pedidos no se borra: se archiva');
    await expect(dialogo).toContainText('Si no tiene pedidos, se borra para siempre');
    await expect(dialogo).toContainText('El producto en MasterShop no se modifica');
    await expect(dialogo.getByRole('button', { name: 'Sí, eliminar' })).toBeVisible();

    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await llamadas(page)).toEqual([]);
  });

  test('sin pedidos: confirmar elimina (una sola llamada) y la lista lo muestra', async ({ page }) => {
    await montar(page, { resultado: 'eliminado' });
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();

    await expect(page.getByRole('status')).toHaveText('Producto eliminado.');
    await expect(page.getByText('Aún no hay productos.')).toBeVisible();
    expect(await llamadas(page)).toEqual(['eliminar']);
  });

  test('con pedidos: queda archivado, se avisa y aparece «Restaurar»', async ({ page }) => {
    await montar(page, { resultado: 'archivado' });
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();

    await expect(page.getByRole('status')).toContainText('tiene pedidos, así que no se borró: quedó archivado');
    await expect(page.getByRole('cell', { name: 'Archivado' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restaurar' })).toBeVisible();
  });

  test('un archivado se restaura con confirmación', async ({ page }) => {
    await montar(page, { estado: 'archived', resultado: 'eliminado' });
    await page.getByRole('button', { name: 'Restaurar' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Restaurar' })).toContainText('vuelve como borrador');
    await page.getByRole('button', { name: 'Sí, restaurar' }).click();
    await expect(page.getByRole('cell', { name: 'Activo' })).toBeVisible();
    expect(await llamadas(page)).toEqual(['restaurar']);
  });

  test('si el servidor falla se muestra el motivo y el producto sigue en la lista', async ({ page }) => {
    await montar(page, { resultado: 'error' });
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.getByRole('alert')).toHaveText('No se pudo eliminar el producto. Inténtalo de nuevo.');
    await expect(page.getByRole('cell', { name: 'Oud Nocturno' })).toBeVisible();
  });

  test('es usable en tablet: los botones miden al menos 44 px de alto', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await montar(page, { resultado: 'eliminado' });
    const caja = await page.getByRole('button', { name: 'Eliminar' }).boundingBox();
    expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
