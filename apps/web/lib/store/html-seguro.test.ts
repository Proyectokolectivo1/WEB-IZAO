import { describe, expect, it } from 'vitest';
import { depurarHtml } from './html-seguro';

describe('depurarHtml', () => {
  it('conserva la estructura editorial', () => {
    expect(depurarHtml('<h2>Envíos</h2><p>Hola <strong>mundo</strong></p><ul><li>uno</li></ul>')).toBe(
      '<h2>Envíos</h2><p>Hola <strong>mundo</strong></p><ul><li>uno</li></ul>',
    );
  });

  it('descarta scripts, estilos, iframes y comentarios con su contenido', () => {
    const r = depurarHtml('<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><!-- x --><p>b</p>');
    expect(r).toBe('<p>a</p><p>b</p>');
  });

  it('quita atributos de evento y de estilo', () => {
    expect(depurarHtml('<p onclick="x()" style="color:red" class="a">t</p>')).toBe('<p>t</p>');
    expect(depurarHtml('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('solo deja enlaces web, correo, teléfono o del sitio', () => {
    expect(depurarHtml('<a href="https://ejemplo.com/a?b=1&c=2">x</a>')).toBe('<a href="https://ejemplo.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>');
    expect(depurarHtml('<a href="/co/catalogo">x</a>')).toBe('<a href="/co/catalogo">x</a>');
    expect(depurarHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="  JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="jav&#x61;script:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="//malo.com">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="/\\malo.com">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="/&#92;malo.com">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="/\\/malo.com">x</a>')).toBe('<a>x</a>');
    expect(depurarHtml('<a href="/perfume/x">x</a>')).toBe('<a href="/perfume/x">x</a>');
    expect(depurarHtml('<a href="data:text/html,<script>">x</a>')).toBe('<a>x</a>');
  });

  it('escapa texto suelto y cierra lo que quedó abierto', () => {
    expect(depurarHtml('a < b > c <p>sin cerrar')).toBe('a &lt; b &gt; c <p>sin cerrar</p>');
    expect(depurarHtml('<p>uno</b></p>')).toBe('<p>uno</p>');
  });
});
