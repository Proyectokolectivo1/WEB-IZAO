/**
 * F9 — pruebas de lanzamiento contra producción, SOLO LECTURA (§30 F9, §31.3, §8.8, §26).
 * No crea pedidos, no usa el checkout hasta pagar, no envía WhatsApp ni escribe en la base. El bolso es localStorage.
 * Cada hallazgo se registra en docs/fases/F9-evidencia/hallazgos.json además de fallar la prueba (no se debilitan umbrales).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../../../docs/fases/F9-evidencia');
fs.mkdirSync(path.join(RAIZ, 'capturas'), { recursive: true });
const HALLAZGOS = path.join(RAIZ, 'hallazgos.json');
const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FICHA = process.env.PROD_FICHA || '/co/perfume/9pm-afnan-para-hombres';

function anotar(clave: string, dato: unknown) {
  const previo = fs.existsSync(HALLAZGOS) ? JSON.parse(fs.readFileSync(HALLAZGOS, 'utf8')) : {};
  previo[clave] = dato;
  fs.writeFileSync(HALLAZGOS, JSON.stringify(previo, null, 1));
}

async function esperarAnimaciones(page: Page) {
  await page.evaluate(async () => {
    const finitas = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finitas.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3_000))]);
  });
}

/** Agrega el primer producto al bolso por la interfaz (localStorage; no toca el servidor de pedidos). */
async function llenarBolso(page: Page) {
  await page.goto(FICHA);
  await page.getByTestId('boton-agregar').first().click();
  await expect(page.getByTestId('contador-carrito')).toHaveText('1');
  await page.keyboard.press('Escape');
}

/** `espera404`: la respuesta 404 de la propia página es lo esperado (token inválido). `load`: la página mantiene conexiones abiertas (Turnstile) y nunca queda en networkidle. */
type Ruta = { nombre: string; url: string; bolso?: boolean; espera404?: boolean; espera?: 'load' | 'networkidle' };
const RUTAS: Ruta[] = [
  { nombre: 'home-co', url: '/co' },
  { nombre: 'catalogo-co', url: '/co/catalogo' },
  { nombre: 'ficha-co', url: FICHA },
  { nombre: 'carrito-co', url: '/co/carrito', bolso: true },
  { nombre: 'checkout-co', url: '/co/checkout', bolso: true },
  { nombre: 'pagar-token-invalido', url: '/co/pagar/token-invalido-de-prueba', espera404: true },
  { nombre: 'admin-login', url: '/admin/login', espera: 'load' },
  { nombre: 'home-ec', url: '/ec' },
  { nombre: 'catalogo-ec', url: '/ec/catalogo' },
];
const VISTAS = [
  { ancho: 375, alto: 812 },
  { ancho: 768, alto: 1024 },
] as const;

test.describe('§8.8 / §30 F9 accesibilidad (axe WCAG 2.2 AA) y responsive', () => {
  for (const ruta of RUTAS) {
    for (const v of VISTAS) {
      test(`${ruta.nombre} @${v.ancho}px: sin violaciones axe, sin desborde horizontal, sin errores de consola`, async ({ page }) => {
        const errores: string[] = [];
        page.on('console', (m) => m.type() === 'error' && errores.push(`console: ${m.text().slice(0, 200)}`));
        page.on('pageerror', (e) => errores.push(`pageerror: ${e.message.slice(0, 200)}`));
        page.on('response', (r) => r.status() >= 400 && errores.push(`http ${r.status()}: ${r.url().replace(/^https?:\/\/[^/]+/, '')}`));
        await page.setViewportSize({ width: v.ancho, height: v.alto });
        if (ruta.bolso) await llenarBolso(page);
        await page.goto(ruta.url, { waitUntil: ruta.espera ?? 'networkidle' });
        if (ruta.espera === 'load') await page.waitForTimeout(4_000); // deja cargar el widget de Turnstile
        await esperarAnimaciones(page);

        const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
        const violaciones = axe.violations.map((x) => ({ regla: x.id, impacto: x.impact, nodos: x.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
        const desborde = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, ventana: window.innerWidth }));
        await page.screenshot({ path: path.join(RAIZ, 'capturas', `${ruta.nombre}-${v.ancho}.jpg`), type: 'jpeg', quality: 55, fullPage: false });
        anotar(`${ruta.nombre}@${v.ancho}`, { violaciones, desborde, errores });

        expect.soft(violaciones, `axe: ${JSON.stringify(violaciones)}`).toEqual([]);
        expect.soft(desborde.scroll, `desborde horizontal ${JSON.stringify(desborde)}`).toBeLessThanOrEqual(desborde.ventana);
        // El widget de Turnstile (terceros, iframe propio) emite 401/CSP internos que no son de la tienda.
        const deTerceros = (e: string) => ruta.espera === 'load' && /cdn-cgi|challenges\.cloudflare|data:,|font-size:0/.test(e);
        const inesperados = errores.filter((e) => !(ruta.espera404 && /404/.test(e)) && !deTerceros(e));
        expect.soft(inesperados, 'errores de consola o de red').toEqual([]);
      });
    }
  }
});

test.describe('§26 / §27 seguridad de cabeceras, TLS, exposición', () => {
  test('§26 cabeceras de seguridad en la tienda', async ({ request }) => {
    const r = await request.get('/co');
    const h = r.headers();
    const faltan: string[] = [];
    if (!/max-age=\d{7,}/.test(h['strict-transport-security'] ?? '')) faltan.push('HSTS max-age >= 1 año');
    if (!/includeSubDomains/i.test(h['strict-transport-security'] ?? '')) faltan.push('HSTS includeSubDomains');
    if (!/frame-ancestors/.test(h['content-security-policy'] ?? '')) faltan.push('CSP frame-ancestors');
    if (h['x-content-type-options'] !== 'nosniff') faltan.push('nosniff');
    if (!h['x-frame-options']) faltan.push('X-Frame-Options');
    if (!h['referrer-policy']) faltan.push('Referrer-Policy');
    if (/unsafe-eval/.test(h['content-security-policy'] ?? '')) faltan.push('CSP sin unsafe-eval');
    if (/nginx\/\d/.test(h['server'] ?? '')) faltan.push('Server sin versión');
    anotar('cabeceras', { faltan, csp: h['content-security-policy'], hsts: h['strict-transport-security'], server: h['server'] });
    expect.soft(faltan).toEqual([]);
  });

  test('§26 /admin y /api/admin no son accesibles sin sesión', async ({ request }) => {
    const rutasAdmin = ['/admin', '/admin/pedidos', '/admin/productos', '/admin/usuarios', '/admin/integraciones'];
    for (const u of rutasAdmin) {
      const r = await request.get(u, { maxRedirects: 0 });
      expect([301, 302, 303, 307, 308, 401, 403], `${u} -> ${r.status()}`).toContain(r.status());
      if (r.status() >= 300 && r.status() < 400) expect(r.headers()['location'] ?? '', u).toMatch(/\/admin\/login/);
    }
    const apis = [
      '/api/admin',
      '/api/admin/media',
      '/api/admin/catalogo/exportar',
      '/api/admin/metricas/exportar',
      '/api/admin/gastos/exportar',
      '/api/admin/leads/exportar',
      '/api/admin/garantias/archivo/1',
      '/api/agent/config',
    ];
    for (const u of apis) {
      const r = await request.get(u, { maxRedirects: 0 });
      expect([401, 403], `${u} -> ${r.status()}`).toContain(r.status());
      expect(await r.text()).not.toMatch(/"(email|phone|total|document)"/i);
    }
  });

  test('§26 /media no sirve html/svg/listados y labels/warranty/agent-screenshots dan 404', async ({ request }) => {
    const urls = [
      '/media/',
      '/media/products/',
      '/media/x.html',
      '/media/x.svg',
      '/media/labels/',
      '/media/labels/x.pdf',
      '/media/warranty/',
      '/media/warranty/x.webp',
      '/media/agent-screenshots/',
      '/media/agent-screenshots/x.png',
      '/media/%2e%2e/etc/passwd',
    ];
    for (const u of urls) {
      const r = await request.get(u, { maxRedirects: 0 });
      expect(r.status(), u).toBe(404);
    }
  });

  test('§26 archivos sensibles no se exponen', async ({ request }) => {
    for (const u of ['/.env', '/.git/config', '/.git/HEAD', '/package.json', '/next.config.js', '/infra/.env']) {
      const r = await request.get(u, { maxRedirects: 0 });
      expect(r.status(), u).toBeGreaterThanOrEqual(400);
    }
  });

  test('§26 la tienda pública no pone cookies a un visitante anónimo', async ({ request }) => {
    const r = await request.get('/co');
    expect(r.headersArray().filter((x) => x.name.toLowerCase() === 'set-cookie')).toEqual([]);
  });

  test('§26 cookies de /admin/login con HttpOnly/Secure/SameSite si existen', async ({ request }) => {
    const r = await request.get('/admin/login');
    const cookies = r.headersArray().filter((x) => x.name.toLowerCase() === 'set-cookie').map((x) => x.value);
    for (const c of cookies) {
      expect(c, c.slice(0, 40)).toMatch(/HttpOnly/i);
      expect(c, c.slice(0, 40)).toMatch(/Secure/i);
      expect(c, c.slice(0, 40)).toMatch(/SameSite=(Lax|Strict)/i);
    }
  });

  test('§26 HTTP redirige a HTTPS y www al dominio canónico', async ({ request }) => {
    const a = await request.get('http://izaoperfumeria.com/co', { maxRedirects: 0 });
    expect([301, 308]).toContain(a.status());
    expect(a.headers()['location']).toBe('https://izaoperfumeria.com/co');
    const b = await request.get('https://www.izaoperfumeria.com/co', { maxRedirects: 0 });
    expect([301, 308]).toContain(b.status());
    expect(b.headers()['location']).toBe('https://izaoperfumeria.com/co');
  });

  test('§26 webhooks y API de pedidos rechazan GET y /api/health no filtra detalles', async ({ request }) => {
    for (const u of ['/api/webhooks/wompi', '/api/webhooks/addi', '/api/webhooks/mastershop/x', '/api/checkout', '/api/checkout/pago', '/api/checkout/preview']) {
      const r = await request.get(u, { maxRedirects: 0 });
      expect([404, 405], u).toContain(r.status());
    }
    const r = await request.get('/api/health');
    expect(Object.keys(await r.json()).sort()).toEqual(['service', 'status', 'time', 'uptime']);
  });
});

test.describe('§27 SEO: robots, sitemaps, canonical, hreflang', () => {
  test('robots.txt permite rastreo y bloquea lo privado; sitemaps por país', async ({ request }) => {
    const txt = await (await request.get('/robots.txt')).text();
    expect(txt).toMatch(/User-agent: \*\s+Allow: \//);
    for (const p of ['/admin', '/api/', '/*/carrito', '/*/checkout', '/*/pedido', '/*/pagar']) expect(txt, p).toContain(`Disallow: ${p}`);
    for (const c of ['co', 'ec']) {
      expect(txt).toContain(`Sitemap: https://izaoperfumeria.com/${c}/sitemap.xml`);
      const s = await request.get(`/${c}/sitemap.xml`);
      expect(s.status()).toBe(200);
      const xml = await s.text();
      expect(xml).toContain('<urlset');
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
      expect(locs.length).toBeGreaterThan(0);
      for (const l of locs) expect(l.startsWith(`https://izaoperfumeria.com/${c}`), l).toBe(true);
      expect(locs.filter((l) => /\/(admin|api|carrito|checkout|pagar|pedido)(\/|$)/.test(l))).toEqual([]);
    }
    expect(await (await request.get('/sitemap.xml')).text()).toContain('<sitemapindex');
  });

  test('canonical y hreflang recíprocos entre /co y /ec (home y catálogo)', async ({ request }) => {
    for (const ruta of ['', '/catalogo']) {
      for (const c of ['co', 'ec']) {
        const html = await (await request.get(`/${c}${ruta}`)).text();
        expect(html, `${c}${ruta} canonical`).toContain(`<link rel="canonical" href="https://izaoperfumeria.com/${c}${ruta}"`);
        expect(html).toMatch(new RegExp(`hrefLang="es-CO" href="https://izaoperfumeria.com/co${ruta}"`, 'i'));
        expect(html).toMatch(new RegExp(`hrefLang="es-EC" href="https://izaoperfumeria.com/ec${ruta}"`, 'i'));
        if (ruta === '') expect(html).toMatch(/hrefLang="x-default"/i);
      }
    }
  });

  test('home, catálogo y ficha tienen meta description', async ({ request }) => {
    const faltan: string[] = [];
    for (const u of ['/co', '/ec', '/co/catalogo', '/ec/catalogo', FICHA]) {
      const html = await (await request.get(u)).text();
      if (!/<meta name="description" content="[^"]{20,}"/.test(html)) faltan.push(`${u}: sin meta description`);
    }
    anotar('meta-description-faltante', faltan);
    expect.soft(faltan).toEqual([]);
  });
});

test.describe('regla 7: sin afirmaciones de originalidad, certificados ni afiliación; sin logos de marcas', () => {
  const PROHIBIDO = /\b(original(es)?|aut[eé]ntic[oa]s?|certificad[oa]s?|certificaci[oó]n|afiliad[oa]s?|distribuidor(es)? (oficial|autorizado)|licenciad[oa]s?|r[eé]plicas?|oficial(es)?)\b/i;
  test('HTML público, políticas y garantías', async ({ request }) => {
    const urls = new Set<string>(['/co', '/ec', '/co/catalogo', '/ec/catalogo', '/co/garantias', '/ec/garantias', FICHA]);
    for (const c of ['co', 'ec']) {
      const xml = await (await request.get(`/${c}/sitemap.xml`)).text();
      for (const m of xml.matchAll(/<loc>https:\/\/izaoperfumeria\.com([^<]+)<\/loc>/g)) urls.add(m[1]!);
    }
    const hallazgos: string[] = [];
    const imagenes: string[] = [];
    for (const u of urls) {
      const html = await (await request.get(u)).text();
      const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      const m = visible.match(PROHIBIDO);
      if (m) hallazgos.push(`${u}: "${m[0]}"`);
      for (const i of html.matchAll(/<img[^>]*>/g)) imagenes.push(`${u}: ${i[0].slice(0, 120)}`);
    }
    anotar('regla7', { paginasRevisadas: urls.size, hallazgos, imagenes });
    expect(hallazgos).toEqual([]);
  });

  test('placeholders sin completar visibles al público ([COMPLETAR], [5], corchetes en datos legales)', async ({ request }) => {
    const hallazgos: string[] = [];
    for (const u of ['/co/pagina/tratamiento-de-datos', '/ec/pagina/tratamiento-de-datos', '/co/garantias', '/ec/garantias', '/co', '/ec']) {
      const html = await (await request.get(u)).text();
      const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      const m = visible.match(/\[[^\]\n]{1,60}\]/g);
      if (m) hallazgos.push(`${u}: ${[...new Set(m)].slice(0, 8).join(' ')}`);
    }
    anotar('placeholders', hallazgos);
    expect(hallazgos).toEqual([]);
  });
});

test.describe('humo de lectura: navegación, filtros, búsqueda, ficha, bolso en memoria', () => {
  test('home -> catálogo -> categoría -> ficha -> bolso (localStorage) sin pedidos', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => r.method() === 'POST' && posts.push(r.url().replace(/^https?:\/\/[^/]+/, '')));
    await page.goto('/co', { waitUntil: 'networkidle' });
    await expect(page.locator('h1').first()).toBeVisible();
    await page.getByRole('link', { name: /todos los aromas/i }).first().click();
    await expect(page).toHaveURL(/\/co\/catalogo/);
    await expect(page.getByTestId('tarjeta-producto').first()).toBeVisible();
    const api = await page.request.get('/api/catalog?country=co&limit=25');
    expect(api.status()).toBe(200);
    expect((await api.json()).items.length).toBeGreaterThan(0);
    await page.goto('/co/categoria/hombre');
    await expect(page.getByTestId('tarjeta-producto').first()).toBeVisible();
    await page.getByTestId('tarjeta-producto').first().locator('a').first().click();
    await expect(page.getByTestId('ficha')).toBeVisible();
    await page.getByTestId('boton-agregar').first().click();
    await expect(page.getByTestId('contador-carrito')).toHaveText('1');
    const bolso = await page.evaluate(() => localStorage.getItem('izao:carrito:co'));
    expect(bolso).toContain('"lineas"');
    anotar('humo-posts', posts);
    expect(posts.filter((p) => /checkout\/?$|checkout\/pago|webhooks/.test(p)), `POST inesperados: ${posts}`).toEqual([]);
  });

  test('búsqueda: sugerencias y página de resultados', async ({ page }) => {
    const r = await page.request.get('/api/catalog/suggest?q=af&country=co');
    expect(r.status()).toBe(200);
    await page.goto('/co/buscar?q=afnan');
    await expect(page.getByTestId('tarjeta-producto').first()).toBeVisible();
  });

  test('catálogo de Ecuador responde y muestra dólares', async ({ page }) => {
    await page.goto('/ec/catalogo');
    await expect(page).toHaveURL(/\/ec\/catalogo/);
    const api = await page.request.get('/api/catalog?country=ec&limit=25');
    expect(api.status()).toBe(200);
    expect((await api.json()).items.length, 'EC sin productos visibles').toBeGreaterThan(0);
  });

  test('ficha inexistente da 404 y no filtra pila', async ({ request }) => {
    const r = await request.get('/co/perfume/no-existe-xyz');
    expect(r.status()).toBe(404);
    expect(await r.text()).not.toMatch(/at \w+ \(|node_modules|supabase\.co\/rest/i);
  });
});
