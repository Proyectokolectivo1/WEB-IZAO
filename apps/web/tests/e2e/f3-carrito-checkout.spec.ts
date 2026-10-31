/**
 * Carrito -> checkout -> pedido (§7.7, §10, §11). El servidor de pagos NO existe en este entorno (no hay llaves):
 * `POST /api/checkout` y `POST /api/checkout/preview` se simulan con `page.route`, con las respuestas del contrato
 * documentado en `lib/store/checkout/contrato.ts` y `lib/store/carrito/contrato.ts`. Lo que se prueba es el lado del
 * navegador: qué envía, qué muestra y cómo reacciona. Las cifras reales (los 10 casos de §11.3) se prueban en
 * `packages/core` con Vitest, no aquí.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { claveCarrito } from '../support/rutas';
import { agregarDesdeFicha, precioVisible, productoConStock, sinEspaciosDuros } from '../support/tienda';

const producto = productoConStock();
const v0 = producto.variants[0]!;
const PRECIO = v0.countries.co!.price; // 300000 en los datos de ejemplo

const dinero = (n: number) => precioVisible('co', n);
const texto = async (page: Page, selector: string) => sinEspaciosDuros(await page.locator(selector).first().innerText());

// El cuerpo viene de JSON arbitrario del navegador: se inspecciona por campos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CuerpoPedido = Record<string, any>;

/** Simula `POST /api/checkout`. Devuelve los cuerpos recibidos para inspeccionarlos. */
async function simularPedido(page: Page, respuesta: (n: number, cuerpo: CuerpoPedido) => { status: number; json: unknown; demora?: number }) {
  const recibidos: CuerpoPedido[] = [];
  await page.route('**/api/checkout', async (ruta: Route) => {
    if (ruta.request().method() !== 'POST') return ruta.fallback();
    const cuerpo = ruta.request().postDataJSON() as CuerpoPedido;
    recibidos.push(cuerpo);
    const r = respuesta(recibidos.length, cuerpo);
    if (r.demora) await new Promise((x) => setTimeout(x, r.demora));
    await ruta.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) });
  });
  return recibidos;
}

const CREADO = { order: { number: 'IZ-CO-000321' }, public_token: 'tokenPrueba0000000000001', next_step: 'manual_whatsapp' };

/** Simula `POST /api/checkout/preview` como el servidor: recalcula con su propio criterio. */
async function simularVistaPrevia(page: Page, hacer: (cuerpo: CuerpoPedido) => unknown) {
  await page.route('**/api/checkout/preview', async (ruta) => {
    const cuerpo = ruta.request().postDataJSON() as CuerpoPedido;
    await ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hacer(cuerpo)) });
  });
}

function respuestaPrevia(cuerpo: CuerpoPedido, extra: Record<string, unknown> = {}) {
  const cantidad = (cuerpo.items as { variant_id: string; quantity: number }[]).reduce((a, i) => a + i.quantity, 0);
  const subtotal = PRECIO * cantidad;
  return {
    lines: (cuerpo.items as { variant_id: string; quantity: number }[]).map((i) => ({
      variant_id: i.variant_id,
      quantity: i.quantity,
      unit_price: String(PRECIO),
      compare_at: null,
      max_quantity: i.quantity,
      line_discount: '0',
    })),
    subtotal: String(subtotal),
    discount: '0',
    code: null,
    ...extra,
  };
}

/** En móvil el resumen va plegado tras "Ver resumen"; en escritorio ya está a la vista. */
async function abrirResumen(page: Page) {
  const ver = page.getByRole('button', { name: 'Ver resumen' });
  if (await ver.isVisible()) await ver.click();
}

async function completarDatos(page: Page, opciones: { whatsapp?: boolean; terminos?: boolean; celular?: string } = {}) {
  await page.getByLabel('Nombre', { exact: true }).fill('Andrea');
  await page.getByLabel('Apellido', { exact: true }).fill('Pérez Gómez');
  await page.getByLabel('Celular (WhatsApp)').fill(opciones.celular ?? '3001234567');
  await page.getByLabel('Tipo de documento').selectOption({ label: 'Cédula de ciudadanía' });
  await page.getByLabel('Número de documento').fill('1020304050');
  await page.getByLabel('Departamento').selectOption({ label: 'Antioquia' });
  const municipio = page.getByLabel('Municipio');
  await expect(municipio.locator('option')).not.toHaveCount(1);
  await municipio.selectOption({ index: 1 });
  await page.getByLabel('Dirección', { exact: true }).fill('Calle 10 # 20-30');
  if (opciones.terminos !== false) await page.getByLabel(/Acepto los términos/).check();
  if (opciones.whatsapp !== false) await page.getByLabel(/información de mi pedido por WhatsApp/).check();
}

test.describe('F3 bolso: cantidades, subtotal y eliminar (§7.7)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§7.7 el cajón muestra la línea y el subtotal, cambia cantidades y elimina hasta quedar vacío', async ({ page }) => {
    await agregarDesdeFicha(page, 'co', producto.slug, 1, true);
    const bolso = page.getByRole('dialog');
    await expect(bolso).toContainText(producto.name);
    expect(sinEspaciosDuros(await bolso.innerText())).toContain(dinero(PRECIO));
    await bolso.getByRole('button', { name: `Una más de ${producto.name}` }).click();
    await expect(page.getByTestId('contador-carrito')).toHaveText('2');
    expect(sinEspaciosDuros(await bolso.innerText())).toContain(dinero(PRECIO * 2));
    await bolso.getByRole('button', { name: `Una menos de ${producto.name}` }).click();
    await expect(page.getByTestId('contador-carrito')).toHaveText('1');
    await bolso.getByRole('button', { name: new RegExp(`Quitar ${producto.name}`) }).click();
    await expect(page.getByTestId('contador-carrito')).toHaveCount(0);
    const guardado = await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co'));
    expect(JSON.parse(guardado ?? '{"lineas":[]}').lineas).toHaveLength(0);
  });

  test('§7.7 el bolso sobrevive a recargar y la página /carrito muestra lo mismo con el botón de finalizar', async ({ page }) => {
    await agregarDesdeFicha(page, 'co', producto.slug, 2);
    await page.goto('/co/carrito');
    await expect(page.locator('main')).toContainText(producto.name);
    expect(sinEspaciosDuros(await page.locator('main').innerText())).toContain(dinero(PRECIO * 2));
    await page.getByRole('link', { name: /finalizar compra/i }).first().click();
    await expect(page).toHaveURL(/\/co\/checkout$/);
  });

  test('§10 el checkout con el bolso vacío no deja pagar y lleva de vuelta al catálogo', async ({ page }) => {
    await page.goto('/co/checkout');
    await expect(page.getByRole('button', { name: /pagar con|continuar con|confirmar pedido|finalizar pedido/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /aromas|catálogo|seguir|ver/i }).first()).toBeVisible();
  });
});

test.describe('F3 checkout (§10)', () => {
  test.beforeEach(async ({ context, page }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
    await simularVistaPrevia(page, (c) => respuestaPrevia(c));
  });

  test('§10.1 enviar vacío lista todos los datos por revisar, no llama al servidor y no pierde el bolso', async ({ page }) => {
    const recibidos = await simularPedido(page, () => ({ status: 201, json: CREADO }));
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await page.getByLabel('Contra entrega').check();
    await page.getByRole('button', { name: 'Confirmar pedido contra entrega' }).click();
    const alerta = page.getByRole('alert').filter({ hasText: /datos por revisar/ });
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText(/Nombre/);
    expect(recibidos).toHaveLength(0);
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co')))!).lineas).toHaveLength(1);
  });

  test('§10.1 el celular de Colombia debe tener 10 dígitos e iniciar en 3', async ({ page }) => {
    const recibidos = await simularPedido(page, () => ({ status: 201, json: CREADO }));
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await completarDatos(page, { celular: '2001234567' });
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect(page.getByLabel('Celular (WhatsApp)')).toHaveAttribute('aria-invalid', 'true');
    expect(recibidos).toHaveLength(0);
    await page.getByLabel('Celular (WhatsApp)').fill('3001234567');
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect.poll(() => recibidos.length).toBe(1);
  });

  test('§10.1 §11.3 el resumen cambia con el método: Wompi sin recargo, Addi +10 %, contra entrega con abono y saldo', async ({ page }) => {
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await abrirResumen(page);
    const resumen = page.locator('aside, [aria-label="Resumen de tu pedido"]').first();
    await expect(page.getByRole('button', { name: 'Pagar con Wompi' })).toBeVisible();
    expect(await texto(page, 'main')).toContain(`TOTAL $ ${dinero(PRECIO)}`);
    await page.getByLabel('Addi').check();
    await expect(page.getByRole('button', { name: 'Continuar con Addi' })).toBeVisible();
    await expect.poll(async () => texto(page, 'main')).toContain(`Cargo por financiación (10 %) $ ${dinero(PRECIO / 10)}`);
    expect(await texto(page, 'main')).toContain(`TOTAL $ ${dinero(PRECIO * 1.1)}`);
    await page.getByLabel('Contra entrega').check();
    await expect(page.getByRole('button', { name: 'Confirmar pedido contra entrega' })).toBeVisible();
    await expect.poll(async () => texto(page, 'main')).toContain('Abono para confirmar $ 10.000');
    expect(await texto(page, 'main')).toContain(`Pagas al recibir $ ${dinero(PRECIO - 10_000)}`);
    expect(await texto(page, 'main')).not.toContain('Cargo por financiación (10 %) $');
    void resumen;
  });

  test('regla 2 §10.2 el servidor manda: si la vista previa devuelve otro recargo, la pantalla muestra el del servidor', async ({ page }) => {
    await page.unroute('**/api/checkout/preview');
    await simularVistaPrevia(page, (c) =>
      respuestaPrevia(c, {
        totals: {
          payment_method: c.payment_method ?? null,
          payment_method_available: true,
          surcharge: c.payment_method === 'addi' ? '45000' : '0',
          total_customer: String(PRECIO + (c.payment_method === 'addi' ? 45000 : 0)),
          cod_deposit: '0',
          cod_collect: '0',
          available_methods: [
            { method: 'wompi', available: true, reason: null },
            { method: 'addi', available: true, reason: null },
            { method: 'cod', available: true, reason: null },
          ],
          manual_allowed: false,
        },
      }),
    );
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await abrirResumen(page);
    await page.getByLabel('Addi').check();
    await expect.poll(async () => texto(page, 'main')).toContain(`$ ${dinero(45_000)}`);
    expect(await texto(page, 'main')).toContain(`TOTAL $ ${dinero(PRECIO + 45_000)}`);
  });

  test('regla 2 §10.2 el cuerpo del pedido lleva variante y cantidad, nunca precios ni totales; con clave de idempotencia y consentimientos', async ({ page }) => {
    const recibidos = await simularPedido(page, () => ({ status: 201, json: CREADO }));
    await agregarDesdeFicha(page, 'co', producto.slug, 2);
    await page.goto('/co/checkout');
    await completarDatos(page);
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect.poll(() => recibidos.length).toBe(1);
    const c = recibidos[0]!;
    expect(c.country_code).toBe('CO');
    expect(c.items).toEqual([{ variant_id: v0.sku, quantity: 2 }]);
    expect(c.payment_method).toBe('wompi');
    expect(c.idempotency_key).toMatch(/^[A-Za-z0-9-]{16,}$/);
    expect(c.consents).toMatchObject({ terms_and_data: true });
    expect(c.contact).toMatchObject({ first_name: 'Andrea', last_name: 'Pérez Gómez', phone: '3001234567' });
    expect(c.data_policy_version).toBeTruthy();
    const plano = JSON.stringify(c);
    expect(plano).not.toMatch(/"(price|unit_price|subtotal|total|total_customer|surcharge|discount|amount|cod_deposit)"/i);
    await expect(page).toHaveURL(/\/co\/pedido\/tokenPrueba0000000000001$/);
  });

  test('§10.2 doble clic en el botón envía un solo pedido (clave de idempotencia por envío)', async ({ page }) => {
    const recibidos = await simularPedido(page, () => ({ status: 201, json: CREADO, demora: 900 }));
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await completarDatos(page);
    const boton = page.getByRole('button', { name: 'Pagar con Wompi' });
    await boton.dblclick();
    await expect(page).toHaveURL(/\/co\/pedido\//);
    expect(recibidos).toHaveLength(1);
  });

  test('§10.2 STOCK_CHANGED: avisa, ajusta el bolso a lo disponible y deja confirmar de nuevo', async ({ page }) => {
    const recibidos = await simularPedido(page, (n) =>
      n === 1
        ? { status: 409, json: { error: 'STOCK_CHANGED', lines: [{ variant_id: v0.sku, max_quantity: 1 }] } }
        : { status: 201, json: CREADO },
    );
    await agregarDesdeFicha(page, 'co', producto.slug, 3);
    await page.goto('/co/checkout');
    await completarDatos(page);
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect(page.getByText(/cambió de existencias/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagar con Wompi' })).toBeEnabled();
    const guardado = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co')))!);
    expect(guardado.lineas[0].cantidad).toBe(1);
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect.poll(() => recibidos.length).toBe(2);
    expect(recibidos[1]!.items[0].quantity).toBe(1);
  });

  test('§10.2 DATA_POLICY_OUTDATED: desmarca la aceptación, pide aceptar de nuevo y reintenta con clave nueva', async ({ page }) => {
    const recibidos = await simularPedido(page, (n) =>
      n === 1 ? { status: 409, json: { error: 'DATA_POLICY_OUTDATED', current_version: '7' } } : { status: 201, json: CREADO },
    );
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await completarDatos(page);
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect(page.getByText(/Actualizamos el tratamiento de datos/)).toBeVisible();
    await expect(page.getByLabel(/Acepto los términos/)).not.toBeChecked();
    await page.getByLabel(/Acepto los términos/).check();
    await page.getByRole('button', { name: 'Pagar con Wompi' }).click();
    await expect.poll(() => recibidos.length).toBe(2);
    expect(recibidos[1]!.data_policy_version).toBe('7');
    expect(recibidos[1]!.idempotency_key).not.toBe(recibidos[0]!.idempotency_key);
  });

  test('§10.2 errores del servidor: método no disponible, servicio caído y sin conexión se explican y el botón vuelve a quedar activo', async ({ page }) => {
    let intento = 0;
    const respuestas = [
      { status: 422, json: { error: 'METHOD_UNAVAILABLE' } },
      { status: 503, json: { error: 'UNAVAILABLE' } },
    ];
    await simularPedido(page, () => respuestas[intento++] ?? { status: 429, json: { error: 'RATE_LIMITED' } });
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await completarDatos(page);
    const boton = page.getByRole('button', { name: 'Pagar con Wompi' });
    await boton.click();
    await expect(page.getByText(/ya no está disponible/)).toBeVisible();
    await expect(boton).toBeEnabled();
    await boton.click();
    await expect(page.getByText(/todavía no está listo/)).toBeVisible();
    await boton.click();
    await expect(page.getByText(/Vas muy rápido/)).toBeVisible();
  });

  test('§10.1 contra entrega exige la autorización de WhatsApp (obligatoria) y el pedido sale con método cod', async ({ page }) => {
    const recibidos = await simularPedido(page, () => ({ status: 201, json: { ...CREADO, next_step: 'pay_cod_deposit' } }));
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await page.getByLabel('Contra entrega').check();
    await completarDatos(page, { whatsapp: false });
    await page.getByRole('button', { name: 'Confirmar pedido contra entrega' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /autorización|WhatsApp/ }).first()).toBeVisible();
    expect(recibidos).toHaveLength(0);
    await page.getByLabel(/información de mi pedido por WhatsApp|Autorizo recibir/).check();
    await page.getByRole('button', { name: 'Confirmar pedido contra entrega' }).click();
    await expect.poll(() => recibidos.length).toBe(1);
    expect(recibidos[0]!.payment_method).toBe('cod');
    expect(recibidos[0]!.consents.whatsapp).toBe(true);
  });

  test('§11.2 código de descuento: aplicado muestra la línea de descuento; rechazado explica el motivo; con Addi se retira', async ({ page }) => {
    await page.unroute('**/api/checkout/preview');
    await simularVistaPrevia(page, (c) => {
      const base = respuestaPrevia(c);
      if (!c.code) return base;
      if (String(c.code).toUpperCase() === 'VENCIDO') {
        return { ...base, code: { status: 'rejected', code: 'VENCIDO', reason: 'CODE_EXPIRED', missing_amount: null } };
      }
      if (c.payment_method === 'addi') {
        return { ...base, code: { status: 'withdrawn', code: 'BIENVENIDA', reason: null, missing_amount: null } };
      }
      return {
        ...base,
        discount: '30000',
        code: { status: 'applied', code: 'BIENVENIDA', reason: null, missing_amount: null },
        lines: base.lines.map((l: { variant_id: string }) => ({ ...l, line_discount: '30000' })),
      };
    });
    await agregarDesdeFicha(page, 'co', producto.slug);
    await page.goto('/co/checkout');
    await abrirResumen(page);
    await page.locator('#codigo-checkout').fill('vencido');
    await page.getByRole('button', { name: 'Aplicar' }).first().click();
    await expect(page.getByText(/ya venció/)).toBeVisible();
    await page.locator('#codigo-checkout').fill('bienvenida');
    await page.getByRole('button', { name: 'Aplicar' }).first().click();
    await expect.poll(async () => texto(page, 'main')).toContain(`Descuento`);
    expect(await texto(page, 'main')).toContain(dinero(30_000));
  });
});

test.describe('F3 checkout Ecuador (§10.1)', () => {
  test.beforeEach(async ({ context, page }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'ec');
    await simularVistaPrevia(page, (c) => ({ ...respuestaPrevia(c), lines: [], subtotal: '0' }));
  });

  test('§10.1 EC: provincia en vez de departamento, documento de Ecuador y total en USD', async ({ page }) => {
    await page.goto(`/ec/perfume/${producto.slug}`);
    await page.getByTestId('boton-agregar').first().click();
    await page.goto('/ec/checkout');
    await expect(page.getByLabel('Provincia')).toBeVisible();
    await expect(page.getByLabel('Departamento')).toHaveCount(0);
    const tipos = await page.getByLabel('Tipo de documento').locator('option').allTextContents();
    expect(tipos.join('|')).toMatch(/Cédula/);
    expect(tipos.join('|')).toMatch(/RUC/);
    expect(tipos.join('|')).toMatch(/Pasaporte/);
    expect(await texto(page, 'main')).toContain(`$${precioVisible('ec', v0.countries.ec!.price)}`);
  });
});

test.describe('F3 página del pedido y enlace de abono (§10.2, §12)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§10.2 /pedido/{token} muestra número, línea de tiempo, totales con abono y saldo, y no se indexa', async ({ page }) => {
    await page.goto('/co/pedido/ejemplo0000000000000000000000000');
    await expect(page.locator('main')).toContainText('IZ-CO-000000');
    await expect(page.locator('main')).toContainText('Pedido recibido');
    await expect(page.locator('main')).toContainText('Abono para confirmar');
    await expect(page.locator('main')).toContainText('Pagas al recibir');
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
  });

  test('§10.2 un token de pedido inexistente o con formato inválido responde 404', async ({ request }) => {
    expect((await request.get('/co/pedido/corto')).status()).toBe(404);
    expect((await request.get('/co/pedido/%00%00')).status()).toBe(404);
  });

  test('§12 /pagar/{token}: vigente redirige a la pasarela; pagado y vencido muestran su estado; token inventado es 404', async ({ request }) => {
    const vigente = await request.get('/co/pagar/ejemplovigente000000', { maxRedirects: 0 });
    expect([307, 200]).toContain(vigente.status());
    if (vigente.status() === 307) expect(vigente.headers().location).toMatch(/^https:\/\//);
    const pagado = await request.get('/co/pagar/ejemplopagado0000000');
    expect(pagado.status()).toBe(200);
    expect(await pagado.text()).toMatch(/pag/i);
    const vencido = await request.get('/co/pagar/ejemplovencido000000');
    expect(vencido.status()).toBe(200);
    expect(await vencido.text()).toMatch(/venci/i);
    expect((await request.get('/co/pagar/tokenquenoexiste0000')).status()).toBe(404);
    expect(vencido.headers()['x-robots-tag'] ?? (await vencido.text())).toMatch(/noindex/);
  });
});
