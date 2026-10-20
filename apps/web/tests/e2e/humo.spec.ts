/**
 * Pruebas de humo que pasan hoy (sin llaves ni base real):
 *  - /api/health responde 200.
 *  - /admin/login carga y rechaza credenciales inválidas sin filtrar información (§26.1).
 * El login habla con `supabase-falso.mjs`, nunca con Supabase real.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { URL_SUPABASE_FALSO } from '../support/entorno';
import { RUTAS } from '../support/rutas';

type Peticion = { metodo: string; ruta: string; cuerpo: string };

async function peticionesAlFalso(request: APIRequestContext): Promise<Peticion[]> {
  const r = await request.get(`${URL_SUPABASE_FALSO}/__peticiones`);
  return (await r.json()) as Peticion[];
}

test.describe('humo', () => {
  test('/api/health responde 200 con estado ok y sin caché', async ({ request }) => {
    const r = await request.get(RUTAS.salud);
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toContain('no-store');
    const cuerpo = (await r.json()) as { status: string; service: string };
    expect(cuerpo).toMatchObject({ status: 'ok', service: 'web' });
  });

  test('/admin/login carga y tiene el formulario accesible', async ({ page }) => {
    const r = await page.goto(RUTAS.adminLogin);
    expect(r?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Ingresar al panel' })).toBeVisible();
    await expect(page.getByLabel('Correo')).toBeVisible();
    await expect(page.getByLabel('Contraseña')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
  });

  test('§26.1 /admin/login rechaza credenciales inválidas con un mensaje genérico', async ({ page, request }) => {
    await request.delete(`${URL_SUPABASE_FALSO}/__peticiones`);
    const correo = 'nadie.existe@ejemplo.test';
    const clave = 'clave-incorrecta-de-prueba';

    await page.goto(RUTAS.adminLogin);
    await page.getByLabel('Correo').fill(correo);
    await page.getByLabel('Contraseña').fill(clave);
    await page.getByRole('button', { name: 'Ingresar' }).click();

    const alerta = page.locator('form [role="alert"]');
    await expect(alerta).toHaveText('El correo o la contraseña no son correctos.');
    // No se avanza al panel ni a MFA, y los datos no quedan en la URL.
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(page.url()).not.toContain(clave);
    expect(page.url()).not.toContain('ejemplo.test');
    // El mensaje no distingue "correo inexistente" de "contraseña errónea" ni nombra al proveedor.
    const texto = (await alerta.textContent()) ?? '';
    expect(texto).not.toMatch(/supabase|invalid|exist|no registrado|bloquead/i);

    // Auditoría: ni el correo ni la contraseña viajan a `audit_log` (solo la huella HMAC).
    const enviadas = await peticionesAlFalso(request);
    const auditoria = enviadas.filter((p) => p.ruta?.includes('/rest/v1/audit_log') && p.cuerpo);
    expect(auditoria.length).toBeGreaterThan(0);
    for (const p of auditoria) {
      expect(p.cuerpo).not.toContain(clave);
      expect(p.cuerpo).not.toContain(correo);
    }
  });

  test('§26.1 /admin sin sesión redirige al login sin mostrar el panel', async ({ page }) => {
    await page.goto('/admin/pedidos');
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole('heading', { name: 'Ingresar al panel' })).toBeVisible();
  });

  test('§26.1 /api/admin sin sesión no entrega datos', async ({ request }) => {
    const r = await request.get('/api/admin/cualquier-cosa', { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403, 404]).toContain(r.status());
    expect(await r.text()).not.toMatch(/"data"|"items"/);
  });
});
