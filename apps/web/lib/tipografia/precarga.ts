import 'server-only';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Archivos `woff2` (subset latin, estilo normal) de las fuentes elegidas, para precargarlos en `<head>`.
 *
 * Con `import()` por fuente `next/font` no emite `<link rel="preload">` (solo lo hace con fuentes importadas de forma
 * estática), y sin precarga el navegador descubre la fuente tarde: el título grande (LCP) se repinta cuando llega.
 * `next/font` solo devuelve clases, no las rutas, así que se leen del CSS ya compilado (`static/css/*.css`): cada
 * `@font-face` trae `font-family`, `font-style` y `src`. Si no hay CSS compilado (desarrollo) o algo cambia de forma,
 * no se precarga nada: la tienda funciona igual, solo sin la mejora.
 */
const cache = new Map<string, { ruta: string | null; hasta: number }>();
let carpetaCss: string | null | undefined;

function leerCss(): string[] {
  if (carpetaCss === undefined) {
    const raiz = process.cwd();
    const candidatas = [process.env.NEXT_DIST_DIR, '.next'].filter((d): d is string => Boolean(d)).map((d) => path.resolve(raiz, d, 'static', 'css'));
    carpetaCss = candidatas.find((c) => existsSync(c)) ?? null;
  }
  if (!carpetaCss) return [];
  try {
    return readdirSync(carpetaCss)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(path.join(carpetaCss as string, f), 'utf8'));
  } catch {
    return [];
  }
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Del CSS compilado, la ruta pública (`/_next/static/media/….woff2`) del subset latin normal de la familia; `null` si no está. */
export function extraerArchivoLatin(css: string, familia: string): string | null {
  const nombre = escapar(familia);
  const bloques = css.match(new RegExp(`@font-face\\{font-family:["']?${nombre}["']?;[^}]*\\}`, 'g')) ?? [];
  // El subset latin es el que empieza con `u+00??` en su `unicode-range`.
  const latin = bloques.find((b) => /font-style:normal/.test(b) && /unicode-range:u\+00\?\?/i.test(b));
  return latin?.match(/url\((\/_next\/static\/media\/[a-zA-Z0-9_.-]+\.woff2)\)/)?.[1] ?? null;
}

/** Cuánto se recuerda que NO se encontró el CSS de una familia (evita releer todos los CSS en cada petición). */
export const TTL_NEGATIVO_MS = 60_000;

/** Solo para pruebas: vacía lo recordado. */
export function reiniciarCachePrecarga(): void {
  cache.clear();
  carpetaCss = undefined;
}

/**
 * `ahora` y `leer` se pueden inyectar en pruebas. Un acierto se recuerda para siempre (el CSS compilado no cambia);
 * un fallo, `TTL_NEGATIVO_MS`: pasado ese tiempo se vuelve a intentar (p. ej. si el CSS aún no existía al arrancar).
 */
export function archivoLatinDe(familia: string, ahora: number = Date.now(), leer: () => string[] = leerCss): string | null {
  const previo = cache.get(familia);
  if (previo && (previo.ruta !== null || previo.hasta > ahora)) return previo.ruta;
  let ruta: string | null = null;
  for (const css of leer()) {
    ruta = extraerArchivoLatin(css, familia);
    if (ruta) break;
  }
  cache.set(familia, { ruta, hasta: ruta ? Infinity : ahora + TTL_NEGATIVO_MS });
  if (!ruta) carpetaCss = undefined; // reintenta localizar la carpeta si el fallo fue por no existir aún
  return ruta;
}

export function archivosPrecarga(familias: readonly string[]): string[] {
  return [...new Set(familias.map((f) => archivoLatinDe(f)).filter((r): r is string => r !== null))];
}
