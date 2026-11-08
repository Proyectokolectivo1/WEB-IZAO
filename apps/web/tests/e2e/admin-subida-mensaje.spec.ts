/**
 * Subida de imágenes del panel: ante un 401 del middleware (`{"error":"sin-sesion"}`) el selector real muestra un mensaje
 * humano con enlace a entrar de nuevo y nunca el código técnico. La API se simula con `page.route`.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

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

const CASOS = [
  { nombre: '401 sin-sesion', status: 401, cuerpo: { error: 'sin-sesion' }, texto: /Tu sesión venció\. Vuelve a entrar al panel y sube la imagen de nuevo\./, enlace: true },
  { nombre: '403 sin-permiso', status: 403, cuerpo: { error: 'sin-permiso' }, texto: /No tienes permiso/, enlace: false },
  { nombre: '413 de Nginx (HTML)', status: 413, cuerpo: '<html>413</html>', texto: /pesa demasiado/, enlace: false },
  { nombre: '502 de Nginx (HTML)', status: 502, cuerpo: '<html>502</html>', texto: /no pudo procesar/, enlace: false },
] as const;

for (const caso of CASOS) {
  test(`SelectorImagen muestra un mensaje humano ante ${caso.nombre}`, async ({ page }) => {
    await page.route('**/__subida__', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Subida</title></head><body><div id="raiz"></div></body></html>' }),
    );
    await page.route('**/api/admin/media', (r) =>
      typeof caso.cuerpo === 'string'
        ? r.fulfill({ status: caso.status, contentType: 'text/html', body: caso.cuerpo })
        : r.fulfill({ status: caso.status, contentType: 'application/json', body: JSON.stringify(caso.cuerpo) }),
    );
    await page.goto('/__subida__');
    await page.addScriptTag({ content: bundle });

    // El ejemplo del campo usa el nombre ya conocido del elemento.
    const alt = page.getByLabel('Texto alternativo');
    await expect(alt).toHaveAttribute('placeholder', 'Ej.: Árabes');
    await alt.fill('Frasco ámbar sobre fondo claro');
    await page.getByLabel('Subir imagen').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });

    const aviso = page.getByRole('alert');
    await expect(aviso).toContainText(caso.texto);
    await expect(aviso).not.toContainText(/sin-sesion|sin-permiso|sin-acceso|mfa-/);
    if (caso.enlace) {
      const enlace = aviso.getByRole('link', { name: /Entrar al panel/ });
      await expect(enlace).toHaveAttribute('href', '/admin/login');
      await expect(enlace).toHaveAttribute('target', '_blank');
    } else {
      await expect(aviso.getByRole('link')).toHaveCount(0);
    }
  });
}

test('la validación del texto alternativo sigue ahí: sin él no llama a la API y lo avisa sin error rojo', async ({ page }) => {
  let llamadas = 0;
  await page.route('**/__subida__', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Subida</title></head><body><div id="raiz"></div></body></html>' }),
  );
  await page.route('**/api/admin/media', (r) => {
    llamadas += 1;
    return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"sin-sesion"}' });
  });
  await page.goto('/__subida__');
  await page.addScriptTag({ content: bundle });
  await page.getByLabel('Subir imagen').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByRole('status')).toContainText('Falta una descripción corta para subir "foto.png"');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(llamadas).toBe(0);
});
