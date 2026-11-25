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

  it('opt-in: el HTML del servidor no trae script, imagen ni noscript del Pixel (ni de CO ni de EC)', () => {
    for (const id of ['111111111111111', '222222222222222']) {
      const html = renderToStaticMarkup(createElement(MetaPixel, { pixelId: id }));
      expect(html).toBe('');
      expect(html).not.toMatch(/fbevents|facebook|<script|<noscript|<img/i);
    }
  });

  it('el HTML no lleva token ni nada de la API de Conversiones', () => {
    const html = renderToStaticMarkup(createElement(MetaPixel, { pixelId: '111111111111111' }));
    expect(html).not.toContain(TOKEN);
    expect(html).not.toMatch(/capi_token|access_token|EAA/);
  });
});
