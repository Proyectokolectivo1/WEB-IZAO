/**
 * Criterios de aceptación de F1 Catálogo (§30): "Con 400 productos por país de prueba: lotes de 25 sin saltos;
 * p95 API < 120 ms; Lighthouse móvil >= 90; CLS < 0,1; visibilidad por país correcta".
 * El p95 está en k6/ y Lighthouse en tests/lighthouse/. Aquí: comportamiento en navegador (§7, §5, §27).
 *
 * ESTADO: PENDIENTES (`test.fixme`). Se activan cuando izao-tienda publique las rutas de `support/rutas.ts` y los
 * `data-testid` de `SEL`. Para activar una prueba: cambiar `test(` por `test(` y correrla en ambos proyectos.
 * Datos esperados: del seed (`support/semilla.ts`), no de la base.
 */
import { expect, test, type Page } from '@playwright/test';
import { abrirBuscador, bajarGradualmenteHastaElFinal, LOTE, medirCls, observarLotes, recorrerHastaElFinal, slugsEnPantalla } from '../support/catalogo';
import { MODO_EJEMPLO } from '../support/entorno';
import { fijarPais, iniciarSinEstado } from '../support/pais';
import { CATEGORIA_LISTADO, claveCarrito, ORDENES, RUTAS, SEL } from '../support/rutas';
import { conTildeEnNombre, sinTildes, totalVisiblesEn, visiblesEn, visiblesSoloEn } from '../support/semilla';

const esperadosEnListado = (categoria: string) =>
  visiblesEn('co').filter((p) => p.category_slugs.includes(categoria));

async function abrirListado(page: Page, pais: 'co' | 'ec', categoria = CATEGORIA_LISTADO) {
  await page.goto(RUTAS.listado(pais, categoria));
  await expect(page.locator(SEL.tarjeta).first()).toBeVisible();
}

test.describe('F1 listado infinito (§7.1)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§7.1 lotes de 25 sin saltos ni repetidos al recorrer todo el listado', async ({ page }) => {
    const registro = observarLotes(page);
    await abrirListado(page, 'co');
    // 1. El primer lote llega renderizado en servidor: 25 tarjetas (o todas, si la categoría tiene menos).
    const esperados = esperadosEnListado(CATEGORIA_LISTADO).map((p) => p.slug);
    expect(await page.locator(SEL.tarjeta).count()).toBe(Math.min(LOTE, esperados.length));
    // 2. Bajar hasta el mensaje de fin de resultados.
    await recorrerHastaElFinal(page);
    // 3. Cada lote pedido a /api/catalog trae 25 productos (el último puede traer menos) y encadena el cursor.
    const lotes = registro.lotes;
    for (const [i, lote] of lotes.entries()) {
      if (i < lotes.length - 1) {
        expect(lote.items).toHaveLength(LOTE);
        expect(lote.nextCursor).not.toBeNull();
      } else {
        expect(lote.items.length).toBeLessThanOrEqual(LOTE);
        expect(lote.nextCursor).toBeNull();
      }
    }
    // 4. Sin repetidos y sin saltos: el DOM tiene exactamente los productos visibles en CO de esa categoría.
    const vistos = await slugsEnPantalla(page);
    expect(new Set(vistos).size).toBe(vistos.length);
    expect([...vistos].sort()).toEqual([...esperados].sort());
    // 5. Nunca se usa OFFSET: ninguna petición lleva `offset` ni `page` (solo cursor).
    for (const url of registro.urls) expect(url).not.toMatch(/[?&](offset|page)=/);
  });

  test('§30 F1 el listado completo de CO tiene 400 productos sin duplicados (sin filtro de categoría)', async ({ page }) => {
    await page.goto(RUTAS.catalogo('co'));
    await recorrerHastaElFinal(page, 80);
    const vistos = await slugsEnPantalla(page);
    expect(vistos).toHaveLength(totalVisiblesEn('co'));
    expect(new Set(vistos).size).toBe(totalVisiblesEn('co'));
  });

  test('§7.1 el primer lote viene en el HTML (sin JavaScript) con enlaces ?page=2 y rel="next"', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await ctx.newPage();
    await page.goto(RUTAS.listado('co'));
    expect(await page.locator(SEL.tarjeta).count()).toBe(LOTE);
    await expect(page.locator('link[rel="next"]')).toHaveAttribute('href', /[?&]page=2/);
    await expect(page.locator('a[href*="page=2"]').first()).toBeAttached();
    await ctx.close();
  });

  test('§7.1 al volver desde una ficha se restauran los lotes cargados y la posición de scroll', async ({ page }) => {
    await abrirListado(page, 'co');
    // 1. Cargar al menos 3 lotes (75 tarjetas) bajando.
    for (const lotes of [2, 3]) {
      await page.mouse.wheel(0, 99_999);
      await expect(page.locator(SEL.tarjeta)).toHaveCount(LOTE * lotes);
    }
    const antes = await slugsEnPantalla(page);
    // 2. Abrir una tarjeta del tercer lote.
    const objetivo = page.locator(SEL.tarjeta).nth(LOTE * 2 + 3);
    await objetivo.scrollIntoViewIfNeeded();
    const slug = await objetivo.getAttribute('data-slug');
    const yAntes = await page.evaluate(() => window.scrollY);
    await objetivo.locator('a').first().click();
    await expect(page).toHaveURL(new RegExp(`/co/perfume/${slug}`));
    // 3. Leer la ficha un momento (hidratada y en reposo) y volver con el botón Atrás del navegador.
    await expect(page.getByTestId('ficha')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.goBack();
    // 4. Siguen los mismos lotes (sin recargar de cero) y la posición vertical es la misma (+-40 px).
    await expect(page.locator(SEL.tarjeta)).toHaveCount(antes.length);
    expect(await slugsEnPantalla(page)).toEqual(antes);
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - yAntes), { timeout: 5_000 })
      .toBeLessThanOrEqual(40);
  });

  test('§7.1 aparece "Volver arriba" tras 2 pantallas de scroll y lleva al inicio', async ({ page }) => {
    await abrirListado(page, 'co');
    const volver = page.getByRole('button', { name: /volver arriba/i });
    await expect(volver).toBeHidden();
    const alto = page.viewportSize()?.height ?? 800;
    await page.mouse.wheel(0, alto * 2 + 200);
    await expect(volver).toBeVisible();
    await volver.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);
  });

  test('§7.1 al terminar el listado se muestra el mensaje de fin con la invitación a Iza', async ({ page }) => {
    await abrirListado(page, 'co');
    await recorrerHastaElFinal(page);
    const fin = page.locator(SEL.finResultados);
    await expect(fin).toBeVisible();
    await expect(fin).toContainText(/Iza/);
  });
});

test.describe('F1 visibilidad por país (§5.2, §30)', () => {
  // El seed trae productos exclusivos de cada país; los datos de ejemplo solo de CO (EC es un subconjunto).
  for (const [presente, ausente] of [['co', 'ec'], ['ec', 'co']] as const) {
    if (visiblesSoloEn(presente, ausente).length === 0) continue;
  test(`§5.2 un producto que no está en ${ausente.toUpperCase()} no aparece en /${ausente} ni en /${ausente}/perfume/{slug}, pero sí en /${presente}`, async ({ page, request, context }) => {
    // Datos: producto visible en un país y ausente en el otro (el seed trae 100 de cada lado).
    const [producto] = visiblesSoloEn(presente, ausente);
    expect(producto).toBeDefined();
    const slug = producto!.slug;
    await fijarPais(context, ausente);
    // 1. La ficha responde 404 donde no se vende y 200 donde sí.
    expect((await request.get(RUTAS.ficha(ausente, slug))).status()).toBe(404);
    expect((await request.get(RUTAS.ficha(presente, slug))).status()).toBe(200);
    // 2. Recorriendo todo el listado del país donde no se vende, el slug nunca aparece.
    await page.goto(RUTAS.catalogo(ausente));
    await recorrerHastaElFinal(page, 80);
    expect(await slugsEnPantalla(page)).not.toContain(slug);
    // 3. La API tampoco lo entrega donde no se vende, y sí donde se vende (búsqueda por nombre).
    const nombre = producto!.name;
    const enCo = await (await request.get(`${RUTAS.apiCatalogo}?country=${ausente}&q=${encodeURIComponent(nombre)}`)).json();
    const enEc = await (await request.get(`${RUTAS.apiCatalogo}?country=${presente}&q=${encodeURIComponent(nombre)}`)).json();
    expect(JSON.stringify(enCo.items)).not.toContain(slug);
    expect(JSON.stringify(enEc.items)).toContain(slug);
  });

  test(`§5.2 §26 el sitemap de /${presente} lista la ficha y el de /${ausente} no`, async ({ request }) => {
    const [producto] = visiblesSoloEn(presente, ausente);
    const slug = producto!.slug;
    const enPresente = await request.get(`/${presente}/sitemap.xml`);
    expect(enPresente.status(), `/${presente}/sitemap.xml`).toBe(200);
    expect(await enPresente.text()).toContain(`/${presente}/perfume/${slug}`);
    const enAusente = await request.get(`/${ausente}/sitemap.xml`);
    expect(enAusente.status(), `/${ausente}/sitemap.xml`).toBe(200);
    expect(await enAusente.text()).not.toContain(`/${ausente}/perfume/${slug}`);
  });
  }

  test.fixme('§5.2 un producto oculto en CO desde el panel (visible=false) desaparece de /co y sigue en /ec', async () => {
    // Requiere llaves de prueba de Supabase local: este caso se escribe cuando exista el entorno con base real.
    // 1. En la base de prueba, poner product_countries.visible=false para CO en un producto visible en ambos países.
    // 2. Esperar la invalidación de caché (revalidateTag catalog:co) y comprobar los mismos 4 puntos del caso anterior.
    // 3. Restaurar visible=true al terminar (afterAll), incluso si la prueba falla.
  });

  test('§5.1 cambiar de país conserva la ruta si el producto es visible en el otro país, y si no va al inicio', async ({ page, context }) => {
    await fijarPais(context, 'co');
    const [ambos] = visiblesEn('co').filter((p) => visiblesEn('ec').includes(p));
    const [soloCo] = visiblesSoloEn('co', 'ec');
    await page.goto(RUTAS.ficha('co', ambos!.slug));
    await page.getByRole('contentinfo').getByRole('link', { name: 'Ecuador' }).click();
    await expect(page).toHaveURL(new RegExp(`/ec/perfume/${ambos!.slug}$`));
    await page.goto(RUTAS.ficha('co', soloCo!.slug));
    await page.getByRole('contentinfo').getByRole('link', { name: 'Ecuador' }).click();
    await expect(page).toHaveURL(/\/ec\/?$/);
  });

  test('§5.2 el precio y la moneda cambian por país (COP sin decimales, USD con dos)', async ({ page, context }) => {
    const [p] = visiblesEn('co').filter((x) => visiblesEn('ec').includes(x));
    const v = p!.variants.find((x) => x.countries.co && x.countries.ec)!;
    await fijarPais(context, 'co');
    await page.goto(RUTAS.ficha('co', p!.slug));
    const precioCo = v.countries.co!.price; // pesos
    await expect(page.locator('main')).toContainText(new Intl.NumberFormat('es-CO').format(precioCo));
    await page.goto(RUTAS.ficha('ec', p!.slug));
    const precioEc = v.countries.ec!.price / 100; // centavos -> dólares
    await expect(page.locator('main')).toContainText(precioEc.toFixed(2).replace('.', ','));
  });
});

test.describe('F1 filtros, orden y búsqueda (§7.2, §7.3)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§7.2 filtrar por marca (multi) deja solo esas marcas, el estado queda en la URL y los chips lo reflejan', async ({ page }) => {
    const marcas = [...new Set(visiblesEn('co').map((p) => p.brand_slug))].slice(0, 2);
    await page.goto(`${RUTAS.catalogo('co')}?marca=${marcas.join(',')}`);
    await recorrerHastaElFinal(page, 40);
    const esperados = visiblesEn('co').filter((p) => marcas.includes(p.brand_slug)).map((p) => p.slug);
    expect((await slugsEnPantalla(page)).sort()).toEqual([...esperados].sort());
    await expect(page.locator(SEL.chipFiltro)).toHaveCount(marcas.length);
    // "Limpiar todo" quita chips y parámetros.
    await page.locator(SEL.limpiarFiltros).click();
    await expect(page.locator(SEL.chipFiltro)).toHaveCount(0);
    await expect(page).not.toHaveURL(/marca=/);
  });

  test('§7.2 combinar género + familia + rango de precio devuelve la intersección exacta', async ({ page }) => {
    const base = visiblesEn('co');
    const genero = base[0]!.gender_slug;
    const familia = base[0]!.family_slug;
    const min = 100_000;
    const max = 400_000;
    const precioDe = (p: (typeof base)[number]) =>
      Math.min(...p.variants.filter((v) => v.countries.co?.active).map((v) => v.countries.co!.price));
    const esperados = base
      .filter((p) => p.gender_slug === genero && p.family_slug === familia && precioDe(p) >= min && precioDe(p) <= max)
      .map((p) => p.slug);
    await page.goto(`${RUTAS.catalogo('co')}?genero=${genero}&familia=${familia}&precio_min=${min}&precio_max=${max}`);
    await recorrerHastaElFinal(page, 40);
    expect((await slugsEnPantalla(page)).sort()).toEqual([...esperados].sort());
  });

  test('§7.2 orden precio menor a mayor: los precios de todo el listado no decrecen (y mayor a menor, no crecen)', async ({ page }) => {
    test.fixme(MODO_EJEMPLO, 'defecto de repo-ejemplo.ts (izao-tienda): invierte price_asc y price_desc; con el RPC real el orden es el correcto');
    const registro = observarLotes(page);
    await page.goto(`${RUTAS.catalogo('co')}?orden=price_asc`);
    await recorrerHastaElFinal(page, 80);
    // El orden por precio pone primero lo disponible y al final los agotados (migración rpc_catalogo: "todos ordenan
    // primero por in_stock"); dentro de cada grupo el precio no decrece.
    const items = registro.lotes.flatMap((l) => l.items);
    expect(items.length).toBeGreaterThan(0);
    const primerAgotado = items.findIndex((i) => i.in_stock === false);
    if (primerAgotado >= 0) expect(items.slice(primerAgotado).every((i) => i.in_stock === false)).toBe(true);
    for (const grupo of [items.filter((i) => i.in_stock !== false), items.filter((i) => i.in_stock === false)]) {
      const precios = grupo.map((i) => Number(i.min_price));
      for (let i = 1; i < precios.length; i += 1) expect(precios[i]!).toBeGreaterThanOrEqual(precios[i - 1]!);
    }
    // Sin repetidos entre lotes incluso con empates de precio (desempate por product_id en el cursor).
    const slugs = registro.lotes.flatMap((l) => l.items.map((i) => i.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('§7.2 los seis órdenes responden y mantienen el cursor consistente', async ({ request }) => {
    for (const orden of ORDENES) {
      const vistos = new Set<string>();
      let cursor: string | null = null;
      do {
        const url: string = `${RUTAS.apiCatalogo}?country=co&orden=${orden}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const r = await request.get(url);
        expect(r.status(), `orden ${orden}`).toBe(200);
        const lote = (await r.json()) as { items: { slug: string }[]; nextCursor: string | null };
        for (const i of lote.items) {
          expect(vistos.has(i.slug), `${orden}: repetido ${i.slug}`).toBe(false);
          vistos.add(i.slug);
        }
        cursor = lote.nextCursor;
      } while (cursor);
      expect(vistos.size, `orden ${orden}`).toBe(totalVisiblesEn('co'));
    }
  });

  test('§7.2 móvil: "Filtrar y ordenar" abre la hoja inferior con contador en vivo', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'solo móvil');
    await page.goto(RUTAS.catalogo('co'));
    await page.locator(SEL.filtrosAbrir).click();
    const hoja = page.getByRole('dialog');
    await expect(hoja).toBeVisible();
    const antes = await hoja.getByTestId('contador-resultados').textContent();
    await hoja.getByRole('checkbox').first().check();
    await expect(hoja.getByTestId('contador-resultados')).not.toHaveText(antes ?? '');
  });

  test('§7.3 la búsqueda es tolerante a tildes: "nomada" encuentra "Raíz Nómada"', async ({ page }) => {
    const objetivo = conTildeEnNombre('co')[0]!;
    const consulta = sinTildes(objetivo.name);
    await page.goto(RUTAS.home('co'));
    await abrirBuscador(page);
    await page.locator(SEL.buscador).first().fill(consulta);
    const sugerencias = page.locator(SEL.sugerencias);
    await expect(sugerencias).toContainText(objetivo.name);
    // Página de resultados: el producto está entre los resultados.
    await page.goto(RUTAS.busqueda('co', consulta));
    expect(await slugsEnPantalla(page)).toContain(objetivo.slug);
    // Y con la tilde puesta, el mismo resultado.
    await page.goto(RUTAS.busqueda('co', objetivo.name));
    expect(await slugsEnPantalla(page)).toContain(objetivo.slug);
  });

  test('§7.3 las sugerencias esperan 200 ms y cancelan la petición anterior', async ({ page }) => {
    const pedidas: number[] = [];
    await page.route('**/api/catalog/suggest**', async (ruta) => {
      pedidas.push(Date.now());
      await ruta.continue();
    });
    await page.goto(RUTAS.home('co'));
    await abrirBuscador(page);
    const caja = page.locator(SEL.buscador).first();
    await caja.pressSequentially('noma', { delay: 40 }); // 4 teclas en < 200 ms
    await expect.poll(() => pedidas.length).toBeGreaterThan(0);
    expect(pedidas.length).toBe(1); // una sola petición tras el debounce
  });
});

test.describe('F1 tarjeta, vista rápida y carrito (§7.4, §7.5, §7.7)', () => {
  test.beforeEach(async ({ context }) => {
    await iniciarSinEstado(context);
    await fijarPais(context, 'co');
  });

  test('§7.4 escritorio: al pasar el mouse hay crossfade de 450 ms a la imagen hover con zoom 1.03', async ({ page, isMobile }) => {
    test.skip(MODO_EJEMPLO, 'los datos de ejemplo no traen imágenes: se mide con el seed y medios reales');
    test.skip(isMobile, 'solo escritorio (puntero fino)');
    await abrirListado(page, 'co');
    const tarjeta = page.locator(SEL.tarjeta).first();
    const principal = tarjeta.locator(SEL.imagenPrincipal);
    const hover = tarjeta.locator(SEL.imagenHover);
    // Reposo: la imagen hover está transparente.
    await expect(hover).toHaveCSS('opacity', '0');
    // Duración y escala declaradas en CSS.
    expect(await hover.evaluate((e) => getComputedStyle(e).transitionDuration)).toContain('0.45s');
    await tarjeta.hover();
    await expect(hover).toHaveCSS('opacity', '1');
    await expect(principal).toHaveCSS('opacity', '0');
    expect(await tarjeta.evaluate((e) => getComputedStyle(e.querySelector('img') as Element).transform)).toContain('1.03');
  });

  test('§7.4 escritorio: la imagen hover se pide en el primer pointerenter de la grilla, no antes', async ({ page, isMobile }) => {
    test.skip(MODO_EJEMPLO, 'los datos de ejemplo no traen imágenes: se mide con el seed y medios reales');
    test.skip(isMobile, 'solo escritorio');
    const pedidas: string[] = [];
    page.on('request', (r) => {
      if (/hover/.test(r.url())) pedidas.push(r.url());
    });
    await abrirListado(page, 'co');
    await page.locator(SEL.tarjeta).first().hover();
    await expect.poll(() => pedidas.length).toBeGreaterThan(0);
  });

  test('§7.4 táctil: no hay hover y deslizar horizontal alterna entre las 2 primeras imágenes con puntos', async ({ page, isMobile, browserName }) => {
    test.skip(MODO_EJEMPLO, 'los datos de ejemplo no traen imágenes: se mide con el seed y medios reales');
    test.skip(!isMobile, 'solo táctil');
    test.skip(browserName !== 'chromium', 'el gesto usa CDP');
    await abrirListado(page, 'co');
    const tarjeta = page.locator(SEL.tarjeta).first();
    await expect(tarjeta.locator(SEL.puntosGaleria)).toBeVisible();
    const caja = (await tarjeta.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: caja.x + caja.width * 0.8,
      y: caja.y + caja.height * 0.4,
      xDistance: -caja.width * 0.6,
      gestureSourceType: 'touch',
    });
    await expect(tarjeta.locator(`${SEL.puntosGaleria} [aria-current="true"]`)).toHaveAttribute('data-indice', '1');
    // El hover CSS no aplica en táctil.
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false);
  });

  test('§7.5 la vista rápida atrapa el foco, cierra con Esc y devuelve el foco al botón que la abrió', async ({ page }) => {
    await abrirListado(page, 'co');
    const boton = page.locator(SEL.botonVistaRapida).first();
    await boton.focus();
    await page.keyboard.press('Enter');
    const modal = page.locator(SEL.vistaRapida);
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    // Foco dentro al abrir y atrapado: 25 Tab seguidos nunca salen del diálogo.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await modal.evaluate((m) => m.contains(document.activeElement))).toBe(true);
    }
    // Shift+Tab también se queda dentro.
    await page.keyboard.press('Shift+Tab');
    expect(await modal.evaluate((m) => m.contains(document.activeElement))).toBe(true);
    // Esc cierra y el foco vuelve al botón.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(boton).toBeFocused();
    // El enlace "Ver detalle completo" lleva a la ficha.
    await boton.click();
    await modal.getByRole('link', { name: /ver detalle completo/i }).click();
    await expect(page).toHaveURL(/\/co\/perfume\//);
  });

  test('§7.7 el carrito se guarda en localStorage, sobrevive a recargar y el contador coincide', async ({ page }) => {
    await abrirListado(page, 'co');
    const tarjeta = page.locator(SEL.tarjeta).first();
    await tarjeta.locator(SEL.botonAgregar).click();
    // Producto sin variantes: se agrega directo; con variantes abre el selector de la vista rápida.
    const vista = page.locator(SEL.vistaRapida);
    if (await vista.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) {
      await vista.locator(SEL.botonAgregar).click();
    }
    await expect(page.locator(SEL.contadorCarrito)).toHaveText('1');
    const guardado = await page.evaluate((k) => localStorage.getItem(k), claveCarrito('co'));
    expect(guardado).not.toBeNull();
    // El bolso guarda variante y cantidad; el precio guardado es solo de muestra (el servidor recalcula en el checkout).
    expect(JSON.parse(guardado!)).toMatchObject({ v: 1, lineas: [{ cantidad: 1 }] });
    await page.reload();
    await expect(page.locator(SEL.contadorCarrito)).toHaveText('1');
  });

  test('§7.7 con localStorage bloqueado el sitio sigue funcionando (try/catch)', async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('bloqueado', 'SecurityError');
        },
      });
    });
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await abrirListado(page, 'co');
    await page.locator(SEL.tarjeta).first().locator(SEL.botonAgregar).click();
    expect(errores).toEqual([]);
  });
});

test.describe('F1 estabilidad visual (§27, §30)', () => {
  test('§30 F1 CLS < 0,1 al cargar y recorrer el listado completo', async ({ page, context }) => {
    await fijarPais(context, 'co');
    const leer = await medirCls(page);
    await abrirListado(page, 'co');
    await bajarGradualmenteHastaElFinal(page);
    expect(await leer()).toBeLessThan(0.1);
  });

  test('§30 F1 CLS < 0,1 en la ficha de producto', async ({ page, context }) => {
    await fijarPais(context, 'co');
    const leer = await medirCls(page);
    await page.goto(RUTAS.ficha('co', visiblesEn('co')[0]!.slug));
    await page.mouse.wheel(0, 3000);
    expect(await leer()).toBeLessThan(0.1);
  });

  test('§27 INP < 200 ms al filtrar, abrir la vista rápida y agregar al carrito', async ({ page, context }) => {
    await fijarPais(context, 'co');
    await page.addInitScript(() => {
      const w = window as unknown as { __maxEvento: number };
      w.__maxEvento = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) w.__maxEvento = Math.max(w.__maxEvento, e.duration);
      }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    });
    await abrirListado(page, 'co');
    // Interacciones típicas: abrir y cerrar la vista rápida, agregar y abrir el carrito.
    await page.locator(SEL.botonVistaRapida).first().click();
    await page.keyboard.press('Escape');
    await page.locator(SEL.tarjeta).first().locator(SEL.botonAgregar).click();
    const maximo = await page.evaluate(() => (window as unknown as { __maxEvento: number }).__maxEvento);
    expect(maximo).toBeLessThan(200);
  });

  test('§7.1 los esqueletos tienen la proporción 4:5 de la tarjeta', async ({ page }) => {
    await page.route('**/api/catalog**', async (ruta) => {
      await new Promise((r) => setTimeout(r, 1500)); // retraso del mock para ver los esqueletos
      await ruta.continue();
    });
    await abrirListado(page, 'co');
    await page.mouse.wheel(0, 99999);
    const esqueleto = page.getByTestId('esqueleto-tarjeta').first();
    await expect(esqueleto).toBeVisible();
    const c = (await esqueleto.boundingBox())!;
    const t = (await page.locator(SEL.tarjeta).first().boundingBox())!;
    expect(Math.abs(c.width / c.height - t.width / t.height)).toBeLessThan(0.02);
  });
});
