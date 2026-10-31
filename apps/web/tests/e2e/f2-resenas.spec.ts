/**
 * Reseñas (§9.6): lectura en la ficha y formulario `POST /api/reviews`.
 * Sin base de datos el servidor responde `error` después de validar (ver la ruta), así que el éxito se simula con
 * `page.route`; las validaciones del servidor que ocurren antes de la base se prueban contra la ruta real.
 */
import { expect, test, type Page } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { RUTAS } from '../support/rutas';
import { multipartManual, productoConStock } from '../support/tienda';

const producto = productoConStock();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const foto = (n: number) => ({ name: `resena-${n}.png`, mimeType: 'image/png', buffer: PNG });

async function abrirFormulario(page: Page) {
  await page.goto(RUTAS.ficha('co', producto.slug));
  await page.getByTestId('escribir-resena').click();
  await expect(page.getByLabel('Tu nombre')).toBeVisible();
}

async function llenar(page: Page) {
  await page.getByRole('radio', { name: '5 estrellas' }).check();
  await page.getByLabel('Tu nombre').fill('Andrea Pérez');
  await page.getByLabel('Ciudad (opcional)').fill('Medellín');
  await page.getByLabel('Tu reseña').fill('Dura todo el día y huele a cedro limpio, me encantó para la oficina.');
}

async function simular(page: Page, status: number, json: unknown) {
  const cuerpos: string[] = [];
  await page.route('**/api/reviews', async (ruta) => {
    if (ruta.request().method() !== 'POST') return ruta.fallback();
    cuerpos.push(ruta.request().postData() ?? '');
    await ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  return cuerpos;
}

test.describe('F2 reseñas (§9.6)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§9.6 la ficha muestra promedio, reseñas con nombre abreviado ("Andrea M., Medellín") y la marca de compra verificada', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    const lista = page.getByTestId('lista-resenas');
    await expect(lista).toContainText(/Compra verificada/);
    const texto = await lista.innerText();
    // Nombre + inicial del apellido + ciudad: nunca un apellido completo.
    expect(texto).toMatch(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ]\., [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/);
    await expect(page.getByTestId('escribir-resena')).toBeVisible();
  });

  test('§9.6 el formulario se descarga al pedirlo, enseña los campos y explica la compra verificada', async ({ page }) => {
    await page.goto(RUTAS.ficha('co', producto.slug));
    await expect(page.getByLabel('Tu reseña')).toHaveCount(0);
    await page.getByTestId('escribir-resena').click();
    for (const e of ['Tu nombre', 'Ciudad (opcional)', 'Tu reseña', 'Fotos (opcional)', 'Número de pedido (opcional)', 'Celular con el que compraste']) {
      await expect(page.getByLabel(e)).toBeVisible();
    }
    await expect(page.getByText(/compra verificada/i).first()).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(5);
  });

  test('§9.6 enviar vacío lista los datos por revisar, marca los campos y no llama al servidor', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true });
    await abrirFormulario(page);
    await page.getByRole('button', { name: 'Enviar mi reseña' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Revisa/ })).toBeVisible();
    await expect(page.getByLabel('Tu nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(enviados).toHaveLength(0);
  });

  test('§9.6 éxito: agradece y avisa que pasa por moderación; el envío lleva el producto, la calificación y el texto', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true, verificada: false });
    await abrirFormulario(page);
    await llenar(page);
    await page.getByLabel('Fotos (opcional)').setInputFiles([foto(1), foto(2)]);
    await page.getByRole('button', { name: 'Enviar mi reseña' }).click();
    await expect(page.getByText('Gracias por tu reseña')).toBeVisible();
    await expect(page.getByText(/La revisamos/)).toBeVisible();
    expect(enviados).toHaveLength(1);
    for (const n of ['producto', 'nombre', 'ciudad', 'estrellas', 'texto', 'fotos']) expect(enviados[0]).toContain(`name="${n}"`);
    expect(enviados[0]).toMatch(/name="estrellas"\r?\n\r?\n5/);
  });

  test('§9.6 más de 3 fotos avisa al elegirlas', async ({ page }) => {
    await abrirFormulario(page);
    await page.getByLabel('Fotos (opcional)').setInputFiles([1, 2, 3, 4].map(foto));
    await expect(page.getByText('Máximo 3 fotos.').first()).toBeVisible();
  });

  test('§9.6 un archivo que no es imagen se rechaza', async ({ page }) => {
    await abrirFormulario(page);
    await page.getByLabel('Fotos (opcional)').setInputFiles([{ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') }]);
    await expect(page.getByText(/Solo aceptamos fotos JPG, PNG, WebP o AVIF/).first()).toBeVisible();
  });

  for (const [motivo, status, texto] of [
    ['demasiados', 429, /varias reseñas seguidas/],
    ['error', 503, /No pudimos guardar tu reseña/],
    ['bot', 403, /No pudimos verificar tu envío/],
  ] as const) {
    test(`§9.6 respuesta "${motivo}": mensaje claro y el texto escrito sigue en el formulario`, async ({ page }) => {
      await simular(page, status, { ok: false, motivo });
      await abrirFormulario(page);
      await llenar(page);
      await page.getByRole('button', { name: 'Enviar mi reseña' }).click();
      await expect(page.getByRole('alert').filter({ hasText: texto })).toBeVisible();
      await expect(page.getByLabel('Tu reseña')).toHaveValue(/huele a cedro/);
    });
  }

  test('§9.6 el campo trampa no se ve ni entra al teclado, y si un bot lo llena el envío debe llevarlo', async ({ page }) => {
    const enviados = await simular(page, 201, { ok: true });
    await abrirFormulario(page);
    const trampa = page.locator('input[name="sitio_web"]');
    await expect(trampa).toHaveAttribute('tabindex', '-1');
    await llenar(page);
    await trampa.evaluate((e: HTMLInputElement) => {
      e.value = 'https://spam.example';
    });
    await page.getByRole('button', { name: 'Enviar mi reseña' }).click();
    await expect.poll(() => enviados.length).toBe(1);
    expect(enviados[0]).toMatch(/name="sitio_web"\r?\n\r?\nhttps:\/\/spam\.example/);
  });

  test('§9.6 servidor: campo trampa lleno -> bot; sin datos, más de 3 fotos o un archivo que no es imagen -> 400 con el campo', async ({ request }) => {
    // `producto` es el id del producto (uuid), no el slug: se toma de la API pública del catálogo.
    const lote = (await (await request.get(`${RUTAS.apiCatalogo}?country=co&q=${encodeURIComponent(producto.name)}`)).json()) as {
      items: { slug: string; product_id: string }[];
    };
    const productoId = lote.items.find((i) => i.slug === producto.slug)!.product_id;
    const base = { country: 'co', producto: productoId, nombre: 'Andrea', estrellas: '5', texto: 'Dura todo el día y huele a cedro limpio.', sitio_web: '' };
    const enviar = (campos: Record<string, string>, fotos: { nombre: string; datos: Buffer }[] = []) => {
      const m = multipartManual(campos, 'fotos', fotos);
      return request.post('/api/reviews', { headers: { 'content-type': m.contentType }, data: m.cuerpo });
    };
    const bot = await enviar({ ...base, sitio_web: 'x' });
    expect(bot.status()).toBe(403);
    expect(await bot.json()).toMatchObject({ motivo: 'bot' });
    const vacio = await enviar({ sitio_web: '' });
    expect(vacio.status()).toBe(400);
    expect(await vacio.json()).toMatchObject({ ok: false, motivo: 'campos' });
    const muchas = await enviar(base, [1, 2, 3, 4].map((n) => ({ nombre: `f${n}.png`, datos: PNG })));
    expect(muchas.status()).toBe(400);
    expect(await muchas.json()).toMatchObject({ motivo: 'campos', campos: { fotos: 'muchas_fotos' } });
    const falsa = await enviar(base, [{ nombre: 'a.png', datos: Buffer.from('no soy una imagen') }]);
    expect(falsa.status()).toBe(400);
    expect(await falsa.json()).toMatchObject({ motivo: 'campos', campos: { fotos: 'tipo' } });
  });

  test('§9.6 GET /api/reviews/config entrega solo la clave pública (nunca un secreto)', async ({ request }) => {
    const r = await request.get('/api/reviews/config');
    expect(r.status()).toBe(200);
    const cuerpo = await r.json();
    expect(Object.keys(cuerpo)).toEqual(['turnstileKey']);
  });
});
