/**
 * Widget de Iza (§20). El modelo de lenguaje NUNCA se llama: `POST /api/chat` se simula con SSE (protocolo de
 * `lib/store/chat/sse.ts`) y hay una prueba de humo contra el modo mock del propio servidor (sin credencial de
 * OpenRouter responde el mock). Lo que no se puede probar sin llaves (OpenRouter real, presupuesto de USD 10, Turnstile,
 * Redis) está en docs/fases/F1.md como pendiente.
 */
import { expect, test, type Page } from '@playwright/test';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { RUTAS } from '../support/rutas';
import { visiblesEn } from '../support/semilla';
import { agregarDesdeFicha, productoConStock } from '../support/tienda';

const producto = productoConStock();
const otro = visiblesEn('co').find((p) => p.slug !== producto.slug && (p.variants[0]?.countries.co?.stock ?? 0) > 0)!;

const sse = (...eventos: [string, unknown][]) => eventos.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

const TARJETA = {
  slug: otro.slug,
  nombre: otro.name,
  presentacion: '50 ml',
  precio: '$ 240.000',
  disponible: true,
  url: `/co/perfume/${otro.slug}`,
  imagen: null,
  linea: {
    variantId: otro.variants[0]!.sku,
    productId: '00000000-0000-4000-8000-000000000099',
    slug: otro.slug,
    nombre: otro.name,
    presentacion: '50 ml',
    precio: '240000',
    tachado: null,
    max: 12,
    imagen: null,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cuerpo = Record<string, any>;

async function simularChat(page: Page, responder: (n: number, cuerpo: Cuerpo) => { status?: number; sse?: string; json?: unknown }) {
  const recibidos: Cuerpo[] = [];
  await page.route('**/api/chat', async (ruta) => {
    if (ruta.request().method() !== 'POST') return ruta.fallback();
    recibidos.push(ruta.request().postDataJSON() as Cuerpo);
    const r = responder(recibidos.length, recibidos.at(-1)!);
    if (r.sse !== undefined) {
      await ruta.fulfill({ status: r.status ?? 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }, body: r.sse });
    } else {
      await ruta.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.json ?? {}) });
    }
  });
  return recibidos;
}

/** `GET /api/chat/estado` con un asesor de WhatsApp configurado (en los datos de ejemplo no hay número). */
async function simularEstado(page: Page, extra: Record<string, unknown> = {}) {
  await page.route('**/api/chat/estado**', (ruta) =>
    ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ estado: 'activo', bienvenida: 'Hola, soy Iza.', whatsapp: '', whatsappNumero: '573001112233', maxEntrada: 500, turnstileKey: null, ...extra }),
    }),
  );
}

async function abrir(page: Page) {
  await page.getByTestId('lanzador-iza').click();
  await expect(page.getByTestId('panel-iza')).toBeVisible();
}

async function escribir(page: Page, mensaje: string) {
  const caja = page.getByRole('textbox', { name: 'Escribe tu mensaje' });
  await caja.fill(mensaje);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
}

test.describe('F8 widget de Iza (§20.1)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§20.1 el botón flotante está en todas las páginas de la tienda y abre el panel con saludo y sugerencias; Esc lo cierra y devuelve el foco', async ({ page }) => {
    for (const ruta of [RUTAS.home('co'), RUTAS.catalogo('co'), RUTAS.ficha('co', producto.slug), '/co/garantias']) {
      await page.goto(ruta);
      await expect(page.getByTestId('lanzador-iza'), ruta).toBeVisible();
    }
    await page.goto(RUTAS.home('co'));
    const lanzador = page.getByTestId('lanzador-iza');
    await lanzador.click();
    const panel = page.getByTestId('panel-iza');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Hola, soy Iza/);
    for (const s of ['Para regalar', 'Aromas frescos', '¿Cómo funciona el contra entrega?']) {
      await expect(panel.getByRole('button', { name: s })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(lanzador).toBeFocused();
  });

  test('§20.1 la respuesta llega en streaming y las tarjetas de producto traen precio, "Comprar" y "Ver detalle"', async ({ page }) => {
    await simularChat(page, () => ({
      sse: sse(
        ['sesion', { id: '7f1b1e0e-4f55-4c4b-9c3c-1c1e3a0a0a01' }],
        ['texto', { t: 'Con mucho gusto, ' }],
        ['texto', { t: 'mira esta opción.' }],
        ['tarjeta', TARJETA],
        ['fin', { restantes: 18 }],
      ),
    }));
    await page.goto(RUTAS.home('co'));
    await abrir(page);
    await escribir(page, 'Busco algo fresco para el día');
    const log = page.getByRole('log');
    await expect(log).toContainText('Con mucho gusto, mira esta opción.');
    const tarjeta = page.getByTestId('tarjeta-iza');
    await expect(tarjeta).toHaveCount(1);
    await expect(tarjeta).toContainText(otro.name);
    await expect(tarjeta).toContainText('$ 240.000');
    await expect(tarjeta.getByRole('link', { name: /Ver detalle/ })).toHaveAttribute('href', `/co/perfume/${otro.slug}`);
    await tarjeta.getByRole('button', { name: 'Comprar' }).click();
    await expect(page.getByTestId('contador-carrito')).toHaveText('1');
    await expect(tarjeta.getByRole('link', { name: 'Finalizar compra' })).toHaveAttribute('href', '/co/checkout');
  });

  test('§20.2 el envío lleva país, visitante, mensaje, el producto de la página y el resumen del bolso; nunca precios ni datos personales', async ({ page }) => {
    const recibidos = await simularChat(page, () => ({ sse: sse(['sesion', { id: '7f1b1e0e-4f55-4c4b-9c3c-1c1e3a0a0a02' }], ['texto', { t: 'Claro.' }], ['fin', { restantes: 10 }]) }));
    await agregarDesdeFicha(page, 'co', producto.slug, 2);
    // "¿Dudas? Pregúntale a Iza" abre el chat con el producto como contexto (el botón flotante no lo hace).
    await page.getByTestId('boton-iza').click();
    await expect(page.getByTestId('panel-iza')).toBeVisible();
    await escribir(page, '¿Cuánto dura?');
    await expect(page.getByRole('log')).toContainText('Claro.');
    const c = recibidos[0]!;
    expect(c.country).toBe('co');
    expect(c.message).toBe('¿Cuánto dura?');
    expect(c.visitor_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(c.page).toEqual({ producto: producto.slug });
    expect(c.cart).toEqual([{ nombre: producto.name, cantidad: 2 }]);
    expect(JSON.stringify(c)).not.toMatch(/precio|price|celular|phone|documento/i);
    // El segundo mensaje reutiliza la sesión que devolvió el servidor.
    await expect(page.getByText('Iza está escribiendo…')).toHaveCount(0);
    await escribir(page, 'Gracias');
    await expect.poll(() => recibidos.length).toBe(2);
    expect(recibidos[1]!.session_id).toBe('7f1b1e0e-4f55-4c4b-9c3c-1c1e3a0a0a02');
  });

  test('§20.1 "Hablar con un asesor" siempre está disponible y abre WhatsApp con el número del país y un mensaje prellenado', async ({ page }) => {
    await simularEstado(page);
    await page.goto(RUTAS.home('co'));
    await abrir(page);
    const asesor = page.getByTestId('asesor-iza');
    await expect(asesor).toBeVisible();
    await expect(asesor).toHaveAttribute('target', '_blank');
    await expect(asesor).toHaveAttribute('rel', /noopener/);
    const href = (await asesor.getAttribute('href'))!;
    expect(href).toMatch(/^https:\/\/(wa\.me|api\.whatsapp\.com)\/(send\?phone=)?573001112233/);
    expect(decodeURIComponent(href)).toMatch(/Hola/);
  });

  for (const [estado, status, texto] of [
    ['limite', 429, /Has escrito muchos mensajes seguidos/],
    ['agotado', 503, /Iza está descansando/],
    ['desactivado', 503, /Iza no está disponible/],
    ['entrada_larga', 413, /muy largo/],
    ['sesion_llena', 429, /límite de esta conversación/],
  ] as const) {
    test(`§20.4 estado "${estado}": mensaje claro, sin dejar la conversación colgada${estado === 'agotado' || estado === 'desactivado' ? ' y con el asesor humano como salida' : ''}`, async ({ page }) => {
      await simularEstado(page);
      await simularChat(page, () => ({ status, json: { estado, whatsapp: 'https://wa.me/573001112233' } }));
      await page.goto(RUTAS.home('co'));
      await abrir(page);
      await escribir(page, 'Hola');
      await expect(page.getByText(texto).first()).toBeVisible();
      await expect(page.getByText('Iza está escribiendo…')).toHaveCount(0);
      await expect(page.getByTestId('asesor-iza')).toBeVisible();
    });
  }

  test('§20.2 un corte de red o un evento de error no deja "Iza está escribiendo…" y permite reintentar', async ({ page }) => {
    await simularChat(page, (n) => (n === 1 ? { sse: sse(['sesion', { id: '7f1b1e0e-4f55-4c4b-9c3c-1c1e3a0a0a03' }], ['error', { codigo: 'proveedor' }]) } : { sse: sse(['texto', { t: 'Aquí estoy.' }], ['fin', { restantes: 5 }]) }));
    await page.goto(RUTAS.home('co'));
    await abrir(page);
    await escribir(page, 'Hola');
    await expect(page.getByText('Algo no salió bien. Inténtalo de nuevo o habla con un asesor.')).toBeVisible();
    await expect(page.getByText('Iza está escribiendo…')).toHaveCount(0);
    await escribir(page, 'Hola otra vez');
    await expect(page.getByRole('log')).toContainText('Aquí estoy.');
  });

  test('regla 7 (§20.3) los textos fijos del widget no afirman originalidad, autenticidad ni certificados', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    await abrir(page);
    const texto = await page.getByTestId('panel-iza').innerText();
    expect(texto).not.toMatch(/\b(original(es)?|aut[eé]ntic[oa]s?|certificad[oa]s?)\b/i);
  });

  test('§20.1 accesibilidad: el panel es un diálogo con nombre, la conversación es un log anunciable y el campo tiene etiqueta', async ({ page }) => {
    await page.goto(RUTAS.home('co'));
    await abrir(page);
    await expect(page.getByRole('dialog', { name: /Iza/ })).toBeVisible();
    await expect(page.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByRole('textbox', { name: 'Escribe tu mensaje' })).toBeFocused();
  });

  test('§20.2 humo: sin credencial de OpenRouter el servidor responde con su modo mock, también en streaming y con tarjetas de productos del país', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(RUTAS.home('co'));
    await abrir(page);
    await escribir(page, 'Busco un perfume cítrico para hombre');
    const tarjetas = page.getByTestId('tarjeta-iza');
    await expect(tarjetas.first()).toBeVisible({ timeout: 30_000 });
    const urls = await tarjetas.getByRole('link', { name: /Ver detalle/ }).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    const visibles = new Set(visiblesEn('co').map((p) => `/co/perfume/${p.slug}`));
    for (const u of urls) expect(visibles.has(u!), u!).toBe(true);
  });
});
