/**
 * Garantías públicas (§19): formulario `/{pais}/garantias` -> `POST /{pais}/garantias/enviar`.
 * Sin base de datos el servidor no puede buscar el pedido (es lo que dice el comentario de la ruta), así que el
 * resultado del servidor se simula con `page.route` usando los códigos reales de `lib/store/garantias/textos.ts`.
 * Se prueba en el navegador: validación, adjuntos, qué se envía y cómo se muestra cada respuesta; y directamente el
 * campo trampa (que el servidor sí revisa antes de tocar la base).
 */
import { expect, test, type Page } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';

// 1x1 PNG y cabeceras mínimas reconocibles por firma (el servidor no confía en la extensión).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(40)]);

const foto = (n: number) => ({ name: `foto-${n}.png`, mimeType: 'image/png', buffer: PNG });

async function llenar(page: Page, pais: 'co' | 'ec' = 'co', celular = pais === 'co' ? '3001234567' : '991234567') {
  await page.getByLabel('Número de pedido').fill(`IZ-${pais.toUpperCase()}-000123`);
  await page.getByLabel('Celular con el que compraste').fill(celular);
  await page.getByLabel('Motivo').selectOption({ index: 1 });
  await page.getByLabel('Cuéntanos qué pasó').fill('La tapa llegó rota y el líquido se derramó dentro de la caja.');
}

async function simular(page: Page, status: number, json: unknown) {
  const cuerpos: { campos: string; tamano: number }[] = [];
  await page.route('**/garantias/enviar', async (ruta) => {
    const post = ruta.request().postData() ?? '';
    cuerpos.push({ campos: post, tamano: post.length });
    await ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  return cuerpos;
}

test.describe('F2 garantías públicas (§19)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§19 la página explica el proceso y tiene los campos del formulario con motivos configurables', async ({ page }) => {
    await page.goto('/co/garantias');
    await expect(page.getByRole('heading', { level: 1, name: 'Garantías' })).toBeVisible();
    for (const etiqueta of ['Número de pedido', 'Celular con el que compraste', 'Motivo', 'Cuéntanos qué pasó', 'Fotos o video (opcional)']) {
      await expect(page.getByLabel(etiqueta)).toBeVisible();
    }
    const motivos = await page.getByLabel('Motivo').locator('option').allTextContents();
    expect(motivos.length).toBeGreaterThan(2);
    await expect(page.getByRole('link', { name: /política de tratamiento de datos/ })).toBeVisible();
    await expect(page.getByText(/hasta 5 fotos, o un solo video de hasta 30 MB/i)).toBeVisible();
  });

  test('regla 7 (§19) la página de garantías no afirma originalidad, autenticidad ni certificados', async ({ page }) => {
    await page.goto('/co/garantias');
    const texto = await page.locator('main').innerText();
    expect(texto).not.toMatch(/\b(original(es)?|aut[eé]ntic[oa]s?|certificad[oa]s?)\b/i);
  });

  test('§19 enviar vacío muestra el resumen de errores con el foco, marca los campos y no llama al servidor', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true });
    await page.goto('/co/garantias');
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    const resumen = page.getByRole('alert').filter({ hasText: /Revisa/ });
    await expect(resumen).toBeVisible();
    await expect(page.getByLabel('Número de pedido')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Motivo')).toHaveAttribute('aria-invalid', 'true');
    expect(enviados).toHaveLength(0);
  });

  test('§19 el celular debe ser válido del país (Colombia: 10 dígitos iniciando en 3)', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true });
    await page.goto('/co/garantias');
    await llenar(page, 'co', '2001234567');
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    await expect(page.getByLabel('Celular con el que compraste')).toHaveAttribute('aria-invalid', 'true');
    expect(enviados).toHaveLength(0);
  });

  test('§19 éxito: muestra el número de caso y el plazo de respuesta, y envía los datos y las fotos', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true, numero: 'GAR-CO-0001', respuesta_dias: 2, repetido: false });
    await page.goto('/co/garantias');
    await llenar(page);
    await page.getByLabel('Fotos o video (opcional)').setInputFiles([foto(1), foto(2)]);
    await expect(page.getByRole('button', { name: /Quitar foto-1\.png/ })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    await expect(page.getByTestId('garantia-recibida')).toBeVisible();
    await expect(page.getByTestId('garantia-numero')).toHaveText('GAR-CO-0001');
    await expect(page.getByTestId('garantia-recibida')).toContainText(/WhatsApp/);
    expect(enviados).toHaveLength(1);
    const cuerpo = enviados[0]!.campos;
    for (const nombre of ['pedido', 'celular', 'motivo', 'descripcion', 'adjuntos']) expect(cuerpo).toContain(`name="${nombre}"`);
    expect((cuerpo.match(/name="adjuntos"/g) ?? []).length).toBe(2);
  });

  for (const [codigo, estado, texto] of [
    ['pedido_no_encontrado', 404, /No encontramos un pedido con esos datos/],
    ['sin_entrega', 409, /aún no figura como entregado/],
    ['vencido', 409, /ya terminó/],
    ['demasiados', 429, /varias solicitudes seguidas/],
    ['error', 503, /No pudimos guardar tu solicitud/],
  ] as const) {
    test(`§19 respuesta "${codigo}": explica qué pasó con la voz de la marca y deja reintentar sin perder los datos`, async ({ page }) => {
      await simular(page, estado, { ok: false, motivo: codigo, dias: 30 });
      await page.goto('/co/garantias');
      await llenar(page);
      await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
      await expect(page.getByRole('alert').filter({ hasText: texto })).toBeVisible();
      await expect(page.getByLabel('Cuéntanos qué pasó')).toHaveValue(/La tapa llegó rota/);
      await expect(page.getByRole('button', { name: 'Enviar mi solicitud' })).toBeEnabled();
    });
  }

  test('§19 adjuntos: más de 5 fotos avisa al elegirlas y deja solo las 5 primeras', async ({ page }) => {
    await page.goto('/co/garantias');
    await page.getByLabel('Fotos o video (opcional)').setInputFiles([1, 2, 3, 4, 5, 6].map(foto));
    await expect(page.getByText('Máximo 5 fotos.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Quitar foto-/ })).toHaveCount(5);
  });

  test('§19 adjuntos: fotos y video a la vez se rechazan', async ({ page }) => {
    await page.goto('/co/garantias');
    await page.getByLabel('Fotos o video (opcional)').setInputFiles([foto(1), { name: 'video.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
    await expect(page.getByText('Envía fotos o un video, no los dos a la vez.').first()).toBeVisible();
  });

  test('§19 adjuntos: un archivo que no es imagen ni video se rechaza y no se envía', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true, numero: 'GAR-CO-0002', respuesta_dias: 2 });
    await page.goto('/co/garantias');
    await llenar(page);
    await page.getByLabel('Fotos o video (opcional)').setInputFiles([{ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') }]);
    await expect(page.getByText(/Solo aceptamos fotos JPG, PNG, WebP o AVIF/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    await expect.poll(() => enviados.length).toBeLessThanOrEqual(1);
  });

  test('§19 el campo trampa no se ve, no entra al teclado y NO se lee al enviar: si un bot lo llena, el envío debe llevarlo', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true, numero: 'GAR-CO-0003', respuesta_dias: 2 });
    await page.goto('/co/garantias');
    const trampa = page.locator('input[name="sitio_web"]');
    await expect(trampa).toHaveAttribute('tabindex', '-1');
    await expect(trampa).not.toBeInViewport();
    await llenar(page);
    await trampa.evaluate((e: HTMLInputElement) => {
      e.value = 'https://spam.example';
    });
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    await expect.poll(() => enviados.length).toBe(1);
    // El servidor descarta cualquier envío con sitio_web lleno; para eso el formulario debe mandar lo que hay en el campo.
    expect(enviados[0]!.campos).toMatch(/name="sitio_web"\r?\n\r?\nhttps:\/\/spam\.example/);
  });

  test('§19 servidor: un envío con el campo trampa lleno se rechaza como bot antes de buscar el pedido', async ({ request }) => {
    const r = await request.post('/co/garantias/enviar', {
      multipart: { pedido: 'IZ-CO-000123', celular: '3001234567', motivo: 'dañado', descripcion: 'x'.repeat(30), sitio_web: 'https://spam.example' },
    });
    expect(r.status()).toBe(403);
    expect(await r.json()).toMatchObject({ ok: false, motivo: 'bot' });
  });

  test('§19 un país que no existe responde 404', async ({ request }) => {
    expect((await request.post('/xx/garantias/enviar', { multipart: { a: 'b' } })).status()).toBe(404);
    expect((await request.get('/xx/garantias')).status()).toBe(404);
  });

  test('§19 EC: el ejemplo del número y la validación del celular son de Ecuador (9 dígitos iniciando en 9)', async ({ page, context }) => {
    await fijarPais(context, 'ec');
    const enviados = await simular(page, 201, { ok: true, numero: 'GAR-EC-0001', respuesta_dias: 2 });
    await page.goto('/ec/garantias');
    await expect(page.getByText('IZ-EC-000123')).toBeVisible();
    await llenar(page, 'ec', '3001234567');
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    await expect(page.getByLabel('Celular con el que compraste')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Celular con el que compraste').fill('991234567');
    await page.getByRole('button', { name: 'Enviar mi solicitud' }).click();
    await expect(page.getByTestId('garantia-numero')).toHaveText('GAR-EC-0001');
    expect(enviados).toHaveLength(1);
  });
});
