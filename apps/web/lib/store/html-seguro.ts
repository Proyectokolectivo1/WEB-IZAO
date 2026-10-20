/**
 * Depurador de HTML para el contenido que edita el panel (páginas y políticas). Lista blanca de etiquetas y
 * atributos: lo demás se descarta, y el texto se vuelve a escapar. Sin dependencias, solo servidor o cliente.
 */
const ETIQUETAS = new Set([
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'blockquote', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'small', 'sup', 'sub',
]);
const VACIAS = new Set(['br', 'hr']);
/** Etiquetas cuyo contenido completo se descarta. */
const CON_CONTENIDO_PELIGROSO = /<(script|style|iframe|object|embed|svg|math|template|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ETIQUETA = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATRIBUTO_HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

function escapar(t: string): string {
  return t.replace(/&(?!(?:[a-zA-Z]{2,8}|#\d{1,6}|#x[0-9a-fA-F]{1,5});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Solo enlaces web, correo, teléfono o rutas del sitio (`//` y `/\` serían de otro dominio: el navegador trata la barra invertida como `/`). Los entes numéricos y los espacios no esconden `javascript:`. */
function hrefSeguro(crudo: string): string | null {
  const sinEntes = crudo
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ':')
    // eslint-disable-next-line no-control-regex -- se eliminan a propósito los caracteres de control
    .replace(/[\u0000- \u007f-\u009f]/g, '');
  if (/^(https?:|mailto:|tel:)/i.test(sinEntes) || /^(\/(?![/\\])|#)/.test(sinEntes)) return escapar(crudo.trim());
  return null;
}

export function depurarHtml(html: string): string {
  const sinPeligro = html.replace(/<!--[\s\S]*?-->/g, '').replace(CON_CONTENIDO_PELIGROSO, '');
  let salida = '';
  let ultimo = 0;
  const abiertas: string[] = [];
  for (const m of sinPeligro.matchAll(ETIQUETA)) {
    salida += escapar(sinPeligro.slice(ultimo, m.index));
    ultimo = (m.index ?? 0) + m[0].length;
    const cierre = m[1] === '/';
    const nombre = (m[2] ?? '').toLowerCase();
    if (!ETIQUETAS.has(nombre)) continue;
    if (cierre) {
      const i = abiertas.lastIndexOf(nombre);
      if (i === -1) continue;
      while (abiertas.length > i) salida += `</${abiertas.pop()}>`;
      continue;
    }
    if (VACIAS.has(nombre)) {
      salida += `<${nombre}>`;
      continue;
    }
    let attrs = '';
    if (nombre === 'a') {
      const h = ATRIBUTO_HREF.exec(m[3] ?? '');
      const seguro = h ? hrefSeguro(h[1] ?? h[2] ?? h[3] ?? '') : null;
      if (seguro) attrs = ` href="${seguro}"${/^https?:/i.test(seguro) ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
    }
    abiertas.push(nombre);
    salida += `<${nombre}${attrs}>`;
  }
  salida += escapar(sinPeligro.slice(ultimo));
  while (abiertas.length) salida += `</${abiertas.pop()}>`;
  return salida;
}
