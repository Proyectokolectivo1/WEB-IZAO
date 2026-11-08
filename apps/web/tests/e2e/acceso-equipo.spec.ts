/**
 * «Acceso del equipo»: enlace discreto del pie (y del menú móvil) hacia `/admin`. Relativo (no depende del país),
 * con rel="nofollow", fuera de sitemaps y JSON-LD; `/admin` nunca se sirve con caché pública.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { RAIZ_REPO, URL_WEB, type Pais } from '../support/entorno';
import { fijarPais } from '../support/pais';
import { RUTAS } from '../support/rutas';

const DIR_CAPTURAS = path.join(RAIZ_REPO, 'docs/fases/F9-evidencia/acceso-equipo');

for (const pais of ['co', 'ec'] as Pais[]) {
  test(`el pie de /${pais} trae «Acceso del equipo» hacia /admin, con nofollow`, async ({ page, context }, info) => {
    await fijarPais(context, pais);
    await page.goto(RUTAS.home(pais));
    const enlace = page.getByRole('contentinfo').getByRole('link', { name: 'Acceso del equipo' });
    await expect(enlace).toHaveCount(1);
    await expect(enlace).toHaveAttribute('href', '/admin');
    await expect(enlace).toHaveAttribute('rel', /nofollow/);
    // Táctil mínimo 44 px y foco visible por teclado.
    expect((await enlace.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await enlace.focus();
    await expect(enlace).toBeFocused();
    // El resto del HTML no cambia: solo ese enlace apunta a /admin.
    expect(await page.locator('a[href^="/admin"]').count()).toBe(1);
    // No entra al JSON-LD.
    const jsonld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(jsonld.join('')).not.toContain('/admin');

    if (pais === 'co') {
      fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
      const ancho = page.viewportSize()?.width ?? 0;
      await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
      await page.getByRole('contentinfo').screenshot({ path: path.join(DIR_CAPTURAS, `pie-${info.project.name}-${ancho}.png`) });
    }
  });
}

test('el enlace lleva al login cuando no hay sesión, y /admin nunca va con caché pública', async ({ page, context, request }) => {
  await fijarPais(context, 'co');
  await page.goto(RUTAS.home('co'));
  await page.getByRole('contentinfo').getByRole('link', { name: 'Acceso del equipo' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);

  const r = await request.get(`${URL_WEB}/admin`, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(r.status());
  expect(r.headers()['location']).toContain('/admin/login');
  expect(r.headers()['cache-control']).toContain('no-store');
});

test('no aparece en robots (cerrado) ni en los sitemaps', async ({ request }) => {
  const robots = await (await request.get(`${URL_WEB}/robots.txt`)).text();
  expect(robots).toContain('Disallow: /admin');
  for (const ruta of ['/sitemap.xml', '/co/sitemap.xml', '/ec/sitemap.xml']) {
    const r = await request.get(`${URL_WEB}${ruta}`);
    if (r.ok()) expect(await r.text()).not.toMatch(/\/admin/);
  }
});

test('en móvil el menú lateral también lo ofrece, sin ícono', async ({ page, context }) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 1024, 'El menú lateral solo existe en móvil.');
  await fijarPais(context, 'co');
  await page.goto(RUTAS.home('co'));
  await page.getByRole('button', { name: 'Menú' }).click();
  const enlace = page.getByRole('dialog').getByRole('link', { name: 'Acceso del equipo' });
  await expect(enlace).toHaveAttribute('href', '/admin');
  await expect(enlace).toHaveAttribute('rel', /nofollow/);
});
