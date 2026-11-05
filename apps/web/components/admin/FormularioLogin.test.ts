import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/login/actions', () => ({ iniciarSesion: async () => ({}) }));

(globalThis as { React?: unknown }).React = { createElement };

describe('FormularioLogin con CAPTCHA', () => {
  it('sin clave de sitio no pinta el contenedor del widget (login funciona igual)', async () => {
    const { FormularioLogin } = await import('./FormularioLogin');
    const html = renderToStaticMarkup(createElement(FormularioLogin, { claveCaptcha: null }));
    expect(html).not.toContain('captcha-login');
    expect(html).toContain('name="correo"');
    expect(html).toContain('type="submit"');
  });

  it('con clave de sitio pinta el contenedor y nunca la clave en el HTML', async () => {
    const { FormularioLogin } = await import('./FormularioLogin');
    const html = renderToStaticMarkup(createElement(FormularioLogin, { claveCaptcha: '0x4AAAclave' }));
    expect(html).toContain('captcha-login');
    expect(html).not.toContain('0x4AAAclave');
  });
});
