/**
 * Subida de imágenes del panel con el texto alternativo pendiente: elegir el archivo antes de escribir la descripción NO es
 * un error. El archivo queda pendiente (se ve su nombre), el foco va al campo de texto alternativo y se sube con
 * «Subir ahora». Con la descripción ya escrita, sube de inmediato. Montamos los subidores REALES (SelectorImagen y
 * ProductoImagenes) con la API simulada con `page.route`.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

const RAIZ_WEB = path.resolve(__dirname, '../..');
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
let bundle = '';

test.beforeAll(async () => {
  const salida = await build({
    entryPoints: [path.join(RAIZ_WEB, 'tests/support/subida-entrada.tsx')],
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

type Modo = 'categoria' | 'banner' | 'producto';

/** Monta el subidor y devuelve lo que la API simulada va recibiendo (cada petición con sus campos de texto). */
async function montar(page: Page, modo: Modo, altInicial = '') {
  const peticiones: string[] = [];
  await page.route('**/__subida__', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Subida</title></head><body><div id="raiz"></div></body></html>' }),
  );
  await page.route('**/api/admin/media', (r) => {
    peticiones.push(r.request().postDataBuffer()?.toString('latin1') ?? '');
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: `m${peticiones.length}`, variants: { '400': 'x/foto-400.webp', '800': 'x/foto-800.webp' }, alt: 'servidor' }),
    });
  });
  await page.addInitScript((m) => {
    window.__SUBIDA__ = m;
  }, { modo, altInicial });
  await page.goto('/__subida__');
  await page.addScriptTag({ content: bundle });
  return peticiones;
}

const archivo = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG_1X1 });

test.describe('SelectorImagen (categoría, con su propio texto alternativo)', () => {
  test('archivo sin descripción: queda pendiente, sin error rojo ni llamada a la API, con foco en el campo', async ({ page }) => {
    const peticiones = await montar(page, 'categoria');
    await page.getByLabel('Subir imagen').setInputFiles(archivo('frasco.png'));

    const aviso = page.getByRole('status');
    await expect(aviso).toContainText('Falta una descripción corta para subir "frasco.png".');
    await expect(page.getByLabel('Texto alternativo')).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Subir ahora' })).toBeVisible();
    expect(peticiones).toHaveLength(0);
  });

  test('al escribir la descripción y pulsar «Subir ahora» sube una sola vez', async ({ page }) => {
    const peticiones = await montar(page, 'categoria');
    await page.getByLabel('Subir imagen').setInputFiles(archivo('frasco.png'));
    await page.getByLabel('Texto alternativo').fill('Frasco ámbar sobre fondo claro');
    // Mientras se escribe no se sube: la descripción no se envía a medias.
    expect(peticiones).toHaveLength(0);
    await expect(page.getByRole('status')).toContainText('"frasco.png" está listo para subir.');

    await page.getByRole('button', { name: 'Subir ahora' }).click();
    await expect(page.getByRole('img', { name: 'servidor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Subir ahora' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]).toContain('frasco.png');
    expect(Buffer.from(peticiones[0] ?? '', 'latin1').toString('utf8')).toContain('Frasco ámbar sobre fondo claro');
  });

  test('con la descripción ya escrita sube de inmediato', async ({ page }) => {
    const peticiones = await montar(page, 'categoria');
    await page.getByLabel('Texto alternativo').fill('Frasco ámbar');
    await page.getByLabel('Subir imagen').setInputFiles(archivo('frasco.png'));
    await expect(page.getByRole('img', { name: 'servidor' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Subir ahora' })).toHaveCount(0);
    expect(peticiones).toHaveLength(1);
  });

  test('elegir otro archivo lo reemplaza: solo se sube el último', async ({ page }) => {
    const peticiones = await montar(page, 'categoria');
    const entrada = page.getByLabel('Subir imagen');
    await entrada.setInputFiles(archivo('primero.png'));
    await expect(page.getByRole('status')).toContainText('"primero.png"');
    await entrada.setInputFiles(archivo('segundo.png'));
    await expect(page.getByRole('status')).toContainText('"segundo.png"');
    await expect(page.getByRole('status')).not.toContainText('primero.png');

    await page.getByLabel('Texto alternativo').fill('Caja de regalo');
    await page.getByRole('button', { name: 'Subir ahora' }).click();
    await expect(page.getByRole('img', { name: 'servidor' })).toBeVisible();
    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]).toContain('segundo.png');
    expect(peticiones[0]).not.toContain('primero.png');
  });

  test('«Subir ahora» sin descripción no llama a la API y devuelve el foco al campo', async ({ page }) => {
    const peticiones = await montar(page, 'categoria');
    await page.getByLabel('Subir imagen').setInputFiles(archivo('frasco.png'));
    await page.getByLabel('Texto alternativo').fill('ab');
    await page.getByRole('button', { name: 'Subir ahora' }).click();
    await expect(page.getByLabel('Texto alternativo')).toBeFocused();
    await expect(page.getByRole('status')).toContainText('Falta una descripción corta');
    expect(peticiones).toHaveLength(0);
  });

  test('«Descartar» quita el archivo pendiente', async ({ page }) => {
    const peticiones = await montar(page, 'categoria');
    await page.getByLabel('Subir imagen').setInputFiles(archivo('frasco.png'));
    await page.getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByRole('status')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Subir ahora' })).toHaveCount(0);
    expect(peticiones).toHaveLength(0);
  });
});

test.describe('SelectorImagen de banner (texto alternativo en otro campo del formulario)', () => {
  test('sin descripción: pendiente y el foco va al campo del formulario; luego sube', async ({ page }) => {
    const peticiones = await montar(page, 'banner');
    await page.getByLabel('Subir imagen').setInputFiles(archivo('verano.png'));

    await expect(page.getByRole('status')).toContainText('Falta una descripción corta para subir "verano.png".');
    await expect(page.locator('#alt')).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(peticiones).toHaveLength(0);

    await page.locator('#alt').fill('Banner de verano con frascos');
    await page.getByRole('button', { name: 'Subir ahora' }).click();
    await expect(page.getByRole('img', { name: 'servidor' })).toBeVisible();
    expect(peticiones).toHaveLength(1);
    expect(Buffer.from(peticiones[0] ?? '', 'latin1').toString('utf8')).toContain('Banner de verano con frascos');
  });
});

test.describe('ProductoImagenes (galería)', () => {
  test('varios archivos sin descripción: quedan pendientes y se suben todos con «Subir ahora»', async ({ page }) => {
    const peticiones = await montar(page, 'producto');
    await page.getByLabel('Subir imágenes').setInputFiles([archivo('a.png'), archivo('b.png')]);

    await expect(page.getByRole('status')).toContainText('Falta una descripción corta para subir 2 archivos.');
    await expect(page.getByLabel('Texto alternativo')).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(peticiones).toHaveLength(0);

    await page.getByLabel('Texto alternativo').fill('Perfume en frasco de vidrio');
    await page.getByRole('button', { name: 'Subir ahora' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(2);
    expect(peticiones).toHaveLength(2);
  });

  test('con el nombre del producto como descripción sugerida sube de inmediato', async ({ page }) => {
    const peticiones = await montar(page, 'producto', 'Oud Intenso');
    await page.getByLabel('Subir imágenes').setInputFiles(archivo('a.png'));
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('status')).toHaveText('');
    expect(peticiones).toHaveLength(1);
  });

  test('elegir otros archivos reemplaza los pendientes', async ({ page }) => {
    const peticiones = await montar(page, 'producto');
    const entrada = page.getByLabel('Subir imágenes');
    await entrada.setInputFiles([archivo('a.png'), archivo('b.png')]);
    await entrada.setInputFiles(archivo('c.png'));
    await expect(page.getByRole('status')).toContainText('"c.png"');
    await page.getByLabel('Texto alternativo').fill('Frasco');
    await page.getByRole('button', { name: 'Subir ahora' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    expect(peticiones).toHaveLength(1);
    expect(peticiones[0]).toContain('c.png');
  });
});
