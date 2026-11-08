import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/pedidos' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: { href: string; children?: unknown }) => createElement('a', { href, ...r }, children as never),
}));

(globalThis as { React?: unknown }).React = { createElement };

describe('CascaronAdmin (HTML del servidor)', () => {
  it('sale con el menú cerrado, el botón enlazado a la hoja y el módulo actual marcado', async () => {
    const { CascaronAdmin } = await import('./CascaronAdmin');
    const html = renderToStaticMarkup(
      createElement(
        CascaronAdmin,
        {
          items: [
            { id: 'inicio', etiqueta: 'Inicio', ruta: '/admin' },
            { id: 'pedidos', etiqueta: 'Pedidos', ruta: '/admin/pedidos' },
          ],
          nombre: 'Dueña',
          rol: 'Administrador',
          cerrarSesion: createElement('span', null, 'salir'),
          children: createElement('p', null, 'contenido'),
        },
      ),
    );
    expect(html).toContain('data-menu="cerrado"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="adm-menu"');
    expect(html).toContain('id="adm-menu"');
    expect(html).toContain('aria-label="Módulos del panel"');
    expect(html).toMatch(/href="\/admin\/pedidos"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/pedidos"/);
    expect(html).not.toMatch(/href="\/admin"[^>]*aria-current/);
    expect(html).toContain('id="contenido"');
    expect(html).toContain('contenido');
    expect(html).not.toContain(' inert');
  });
});
