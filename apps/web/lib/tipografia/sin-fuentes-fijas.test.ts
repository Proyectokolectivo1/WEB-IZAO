import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guardia de tipografía: el tema (Apariencia) es la única fuente de verdad de las fuentes, en la tienda y en el panel.
 * Falla si aparece una `font-family` / `fontFamily` / pila genérica fija fuera de las variables:
 *   --font-display (títulos), --font-body (texto) y --font-mono (solo código real).
 * Excepciones documentadas (ver ALLOW_*): definiciones del tema, catálogo de fuentes, muestras del selector de Apariencia
 * y la página PDF de prueba de la impresora (Helvetica base-14 del propio PDF, no es una fuente web).
 */

const RAIZ_WEB = path.resolve(__dirname, '../..');
const RAIZ_UI = path.resolve(__dirname, '../../../../packages/ui/src');

const IGNORAR_DIR = new Set(['node_modules', '.next', '.next-dev', '.next-ejemplo', 'test-results', '.resultados', 'tests', '.lighthouseci', 'public']);

function* archivos(dir: string): Generator<string> {
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR_DIR.has(nombre) || nombre.startsWith('.next')) continue;
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) yield* archivos(ruta);
    else if (/\.(css|ts|tsx)$/.test(nombre) && !/\.(test|spec)\.tsx?$/.test(nombre) && !nombre.endsWith('.generado.ts')) yield ruta;
  }
}

const rel = (ruta: string) => ruta.replaceAll('\\', '/');

/** Quita comentarios para no marcar la documentación. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Definen o transportan fuentes: el catálogo, el tema y los tokens.
const ALLOW_DEFINICION = [/packages\/ui\/src\/tokens\.css$/, /packages\/ui\/src\/tema\//, /apps\/web\/lib\/tipografia\//];
// Muestras de la fuente candidata en Apariencia (cada opción se ve en su propia cara) y la hoja de sus vistas previas.
const ALLOW_MUESTRA = [/apps\/web\/components\/admin\/SelectorFuente\.tsx$/, /apps\/web\/components\/admin\/FormularioApariencia\.tsx$/, /apps\/web\/app\/admin\/apariencia\.css$/];
// PDF de prueba: usa Helvetica base-14 del propio formato PDF.
const ALLOW_PDF = [/apps\/web\/app\/api\/agent\/_lib\/pdf-prueba\.ts$/];

const permitido = (ruta: string, ...listas: RegExp[][]) => listas.flat().some((r) => r.test(rel(ruta)));

const todos = [...archivos(RAIZ_WEB), ...archivos(RAIZ_UI)];

const VALOR_CSS_PERMITIDO = /^(?:inherit|var\(--(?:font-display|font-body|font-mono|adm-fuente|adm-fuente-titulos)\))$/;
const VALOR_MUESTRA_PERMITIDO = /^var\(--prev-(?:display|body)\)$/;

describe('tipografía: una sola fuente de verdad (las variables del tema)', () => {
  it('encuentra archivos que revisar', () => {
    expect(todos.length).toBeGreaterThan(100);
  });

  it('toda `font-family` de CSS usa --font-display, --font-body, --font-mono, las variables del panel que derivan de ellas o inherit', () => {
    const infracciones: string[] = [];
    for (const f of todos.filter((x) => x.endsWith('.css'))) {
      if (permitido(f, ALLOW_DEFINICION)) continue;
      const src = sinComentarios(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
        const valor = m[1]!.trim();
        const ok = VALOR_CSS_PERMITIDO.test(valor) || (permitido(f, ALLOW_MUESTRA) && VALOR_MUESTRA_PERMITIDO.test(valor));
        if (!ok) infracciones.push(`${rel(f)}: font-family: ${valor}`);
      }
      // La abreviatura `font:` solo puede ser `inherit` (los campos heredan la fuente del contenedor).
      for (const m of src.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)) {
        if (m[1]!.trim() !== 'inherit') infracciones.push(`${rel(f)}: font: ${m[1]!.trim()}`);
      }
    }
    expect(infracciones).toEqual([]);
  });

  it('ningún componente fija la fuente en línea (`fontFamily`, `font-family`) ni con clases font-sans|serif|mono', () => {
    const infracciones: string[] = [];
    for (const f of todos.filter((x) => /\.tsx?$/.test(x))) {
      if (permitido(f, ALLOW_DEFINICION, ALLOW_MUESTRA, ALLOW_PDF)) continue;
      const src = sinComentarios(readFileSync(f, 'utf8'));
      for (const re of [/fontFamily/g, /font-family/g, /\bfont-(?:sans|serif|mono)\b/g]) {
        for (const m of src.matchAll(re)) infracciones.push(`${rel(f)}: ${m[0]}`);
      }
      // Las clases arbitrarias de familia solo pueden apuntar a las variables del tema.
      for (const m of src.matchAll(/font-\[family-name:([^\]]+)\]/g)) {
        if (!/^var\(--font-(?:display|body|mono)\)$/.test(m[1]!)) infracciones.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(infracciones).toEqual([]);
  });

  it('no hay pilas genéricas quemadas (Georgia, system-ui, Menlo, Arial…) fuera del tema y del catálogo de fuentes', () => {
    const infracciones: string[] = [];
    const GENERICAS = /\b(?:Georgia|system-ui|ui-monospace|SFMono-Regular|Menlo|Consolas|Segoe UI|Roboto|Arial|Helvetica|Times New Roman|Courier)\b/;
    for (const f of todos) {
      if (permitido(f, ALLOW_DEFINICION, ALLOW_PDF)) continue;
      const src = sinComentarios(readFileSync(f, 'utf8'));
      const m = GENERICAS.exec(src);
      if (m) infracciones.push(`${rel(f)}: ${m[0]}`);
    }
    expect(infracciones).toEqual([]);
  });

  it('el panel deriva su fuente del tema: --adm-fuente = --font-body y los títulos usan --font-display', () => {
    const css = readFileSync(path.join(RAIZ_WEB, 'app/admin/admin.css'), 'utf8');
    expect(css).toMatch(/--adm-fuente:\s*var\(--font-body\)/);
    expect(css).toMatch(/--adm-fuente-titulos:\s*var\(--font-display\)/);
  });

  it('--font-mono se define una sola vez (tokens.css) y el resto del código la consume', () => {
    const definiciones = todos.filter((f) => /--font-mono\s*:/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(definiciones).toEqual([expect.stringMatching(/packages\/ui\/src\/tokens\.css$/)]);
  });
});
