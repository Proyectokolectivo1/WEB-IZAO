import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MetaPixel } from './MetaPixel';

const TOKEN = 'EAAsecretoDelServidor1234567890';

describe('<MetaPixel />', () => {
  it('sin credencial activa no renderiza nada', () => {
    expect(MetaPixel({ pixelId: null })).toBeNull();
    expect(renderToStaticMarkup(createElement(MetaPixel, { pixelId: null }))).toBe('');
  });

  it('usa el Pixel del país y no mezcla el del otro', () => {
    const co = renderToStaticMarkup(createElement(MetaPixel, { pixelId: '111111111111111' }));
    const ec = renderToStaticMarkup(createElement(MetaPixel, { pixelId: '222222222222222' }));
    expect(co).toContain('111111111111111');
    expect(co).not.toContain('222222222222222');
    expect(ec).toContain('222222222222222');
    expect(ec).not.toContain('111111111111111');
    expect(co).toContain('connect.facebook.net/en_US/fbevents.js');
  });

  it('incluye el noscript de Meta con el Pixel ID del país (sin quemar ningún id)', () => {
    const co = renderToStaticMarkup(createElement(MetaPixel, { pixelId: '111111111111111' }));
    const ec = renderToStaticMarkup(createElement(MetaPixel, { pixelId: '222222222222222' }));
    expect(co).toContain('<noscript><img');
    expect(co).toContain('https://www.facebook.com/tr?id=111111111111111&amp;ev=PageView&amp;noscript=1');
    expect(ec).toContain('tr?id=222222222222222&amp;ev=PageView');
    expect(ec).not.toContain('111111111111111');
  });

  it('el HTML no lleva token ni nada de la API de Conversiones', () => {
    const html = renderToStaticMarkup(createElement(MetaPixel, { pixelId: '111111111111111' }));
    expect(html).not.toContain(TOKEN);
    expect(html).not.toMatch(/capi_token|access_token|EAA/);
  });
});
