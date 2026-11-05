/**
 * Catálogo de tipografías para títulos y texto (§8.2, regla 3). Código puro: lo usan el selector de Apariencia, el
 * servidor al validar y, desde ahora, la tienda para cargar SOLO la fuente elegida.
 *
 * Qué se guarda en la base (`site_settings.typography` y `theme_overrides.tokens.typography`):
 *   - `heading_font`: `familia` de la fuente de títulos (p. ej. "Cormorant Garamond").
 *   - `body_font`: `familia` de la fuente de texto (p. ej. "Manrope").
 *   - `pair`: 1–6 SOLO cuando las dos fuentes coinciden con una pareja curada de `PARES_TIPOGRAFICOS`
 *     (así la tienda anterior sigue funcionando); si no coinciden, `pair` conserva su último valor.
 * Un valor fuera de este catálogo se ignora y se cae a la pareja (`pair`).
 *
 * El catálogo vive en código porque `next/font` exige declarar cada fuente de forma estática al compilar: las filas son
 * los valores por defecto del seed y de ellas sale la lista del selector. Todas son de Google Fonts, subset latin.
 */
import { PARES_TIPOGRAFICOS, resolverTipografia } from '@izao/ui/tema';

export const CATEGORIAS_FUENTE = ['serif_editorial', 'serif_lectura', 'sans_geometrica', 'sans_humanista', 'sans_neutra'] as const;
export type CategoriaFuente = (typeof CATEGORIAS_FUENTE)[number];

export const ETIQUETA_CATEGORIA_FUENTE: Record<CategoriaFuente, string> = {
  serif_editorial: 'Serif editorial y de lujo',
  serif_lectura: 'Serif de lectura',
  sans_geometrica: 'Sans geométrica',
  sans_humanista: 'Sans humanista',
  sans_neutra: 'Sans neutra',
};

export type UsoFuente = 'titulos' | 'texto';

export type FuenteCatalogo = {
  /** Identificador estable en minúsculas con guiones (nombre de la variable CSS `--fuente-{id}`). */
  id: string;
  /** Nombre exacto en Google Fonts: es el valor que se guarda en `heading_font` / `body_font`. */
  familia: string;
  categoria: CategoriaFuente;
  /** Para qué funciona mejor; el selector permite cualquiera en cualquier lugar. */
  usos: readonly UsoFuente[];
  /** Pesos que existen (100–900). En una fuente variable son los extremos del rango disponible. */
  pesos: readonly number[];
  variable: boolean;
  cursiva: boolean;
  caracter: string;
};

export const FUENTES_CATALOGO: readonly FuenteCatalogo[] = Object.freeze([
  { id: 'cormorant-garamond', familia: 'Cormorant Garamond', categoria: 'serif_editorial', usos: ['titulos'], pesos: [300, 400, 500, 600, 700], variable: true, cursiva: true, caracter: 'Editorial, lujo cálido' },
  { id: 'cormorant', familia: 'Cormorant', categoria: 'serif_editorial', usos: ['titulos'], pesos: [300, 400, 500, 600, 700], variable: true, cursiva: true, caracter: 'Elegante, trazo fino' },
  { id: 'playfair-display', familia: 'Playfair Display', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Clásico moderno, alto contraste' },
  { id: 'fraunces', familia: 'Fraunces', categoria: 'serif_editorial', usos: ['titulos'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Contemporáneo con calidez' },
  { id: 'libre-caslon-display', familia: 'Libre Caslon Display', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: false, caracter: 'Revista de moda' },
  { id: 'bodoni-moda', familia: 'Bodoni Moda', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Alto contraste, perfumería clásica' },
  { id: 'cinzel', familia: 'Cinzel', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400, 500, 600, 700, 800, 900], variable: true, cursiva: false, caracter: 'Inscripción romana, mayúsculas' },
  { id: 'marcellus', familia: 'Marcellus', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: false, caracter: 'Sereno, inscripción' },
  { id: 'prata', familia: 'Prata', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: false, caracter: 'Didona suave' },
  { id: 'dm-serif-display', familia: 'DM Serif Display', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: true, caracter: 'Contundente y refinada' },
  { id: 'gilda-display', familia: 'Gilda Display', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: false, caracter: 'Delicada, aire clásico' },
  { id: 'italiana', familia: 'Italiana', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: false, caracter: 'Fina, alta costura' },
  { id: 'bellefair', familia: 'Bellefair', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: false, caracter: 'Caligráfica y sobria' },
  { id: 'instrument-serif', familia: 'Instrument Serif', categoria: 'serif_editorial', usos: ['titulos'], pesos: [400], variable: false, cursiva: true, caracter: 'Condensada, editorial actual' },
  { id: 'eb-garamond', familia: 'EB Garamond', categoria: 'serif_lectura', usos: ['titulos', 'texto'], pesos: [400, 500, 600, 700, 800], variable: true, cursiva: true, caracter: 'Garamond clásica, muy legible' },
  { id: 'lora', familia: 'Lora', categoria: 'serif_lectura', usos: ['titulos', 'texto'], pesos: [400, 500, 600, 700], variable: true, cursiva: true, caracter: 'Serif cálida de lectura' },
  { id: 'newsreader', familia: 'Newsreader', categoria: 'serif_lectura', usos: ['texto'], pesos: [200, 300, 400, 500, 600, 700, 800], variable: true, cursiva: true, caracter: 'Serif de periódico, cómoda' },
  { id: 'crimson-pro', familia: 'Crimson Pro', categoria: 'serif_lectura', usos: ['texto'], pesos: [200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Serif de libro, sobria' },
  { id: 'libre-baskerville', familia: 'Libre Baskerville', categoria: 'serif_lectura', usos: ['texto'], pesos: [400, 700], variable: false, cursiva: true, caracter: 'Baskerville clásica' },
  { id: 'manrope', familia: 'Manrope', categoria: 'sans_neutra', usos: ['texto'], pesos: [200, 300, 400, 500, 600, 700, 800], variable: true, cursiva: false, caracter: 'Moderna y limpia' },
  { id: 'jost', familia: 'Jost', categoria: 'sans_geometrica', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Geométrica, aire Bauhaus' },
  { id: 'inter-tight', familia: 'Inter Tight', categoria: 'sans_neutra', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Neutra y compacta' },
  { id: 'karla', familia: 'Karla', categoria: 'sans_neutra', usos: ['texto'], pesos: [200, 300, 400, 500, 600, 700, 800], variable: true, cursiva: true, caracter: 'Grotesca cálida' },
  { id: 'mulish', familia: 'Mulish', categoria: 'sans_humanista', usos: ['texto'], pesos: [200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Suave y amable' },
  { id: 'dm-sans', familia: 'DM Sans', categoria: 'sans_geometrica', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Geométrica de bajo contraste' },
  { id: 'inter', familia: 'Inter', categoria: 'sans_neutra', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Neutra, máxima legibilidad' },
  { id: 'montserrat', familia: 'Montserrat', categoria: 'sans_geometrica', usos: ['titulos', 'texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Geométrica urbana' },
  { id: 'raleway', familia: 'Raleway', categoria: 'sans_geometrica', usos: ['titulos', 'texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Elegante y ligera' },
  { id: 'outfit', familia: 'Outfit', categoria: 'sans_geometrica', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: false, caracter: 'Geométrica redonda' },
  { id: 'figtree', familia: 'Figtree', categoria: 'sans_neutra', usos: ['texto'], pesos: [300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Amistosa y clara' },
  { id: 'plus-jakarta-sans', familia: 'Plus Jakarta Sans', categoria: 'sans_neutra', usos: ['texto'], pesos: [200, 300, 400, 500, 600, 700, 800], variable: true, cursiva: true, caracter: 'Moderna con carácter' },
  { id: 'albert-sans', familia: 'Albert Sans', categoria: 'sans_neutra', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Neutra con personalidad' },
  { id: 'hanken-grotesk', familia: 'Hanken Grotesk', categoria: 'sans_neutra', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Grotesca contemporánea' },
  { id: 'urbanist', familia: 'Urbanist', categoria: 'sans_geometrica', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Geométrica minimalista' },
  { id: 'tenor-sans', familia: 'Tenor Sans', categoria: 'sans_humanista', usos: ['titulos', 'texto'], pesos: [400], variable: false, cursiva: false, caracter: 'Humanista fina de titulares' },
  { id: 'josefin-sans', familia: 'Josefin Sans', categoria: 'sans_geometrica', usos: ['titulos', 'texto'], pesos: [100, 200, 300, 400, 500, 600, 700], variable: true, cursiva: true, caracter: 'Vintage geométrica' },
  { id: 'questrial', familia: 'Questrial', categoria: 'sans_geometrica', usos: ['texto'], pesos: [400], variable: false, cursiva: false, caracter: 'Geométrica simple' },
  { id: 'work-sans', familia: 'Work Sans', categoria: 'sans_neutra', usos: ['texto'], pesos: [100, 200, 300, 400, 500, 600, 700, 800, 900], variable: true, cursiva: true, caracter: 'Grotesca de uso general' },
]);

const POR_FAMILIA = new Map(FUENTES_CATALOGO.map((f) => [f.familia, f]));
const POR_ID = new Map(FUENTES_CATALOGO.map((f) => [f.id, f]));

export const fuentePorFamilia = (familia: unknown): FuenteCatalogo | null =>
  typeof familia === 'string' ? (POR_FAMILIA.get(familia.trim()) ?? null) : null;

export const fuentePorId = (id: string): FuenteCatalogo | null => POR_ID.get(id) ?? null;

/** Variable CSS que define la vista previa de esa fuente (`--fuente-cormorant-garamond`). */
export const variableCssFuente = (f: FuenteCatalogo): string => `--fuente-${f.id}`;

/** Pila de respaldo mientras carga la fuente: serif o sans según su categoría. */
export function pilaFuente(f: FuenteCatalogo): string {
  const nombre = f.familia.includes(' ') ? `'${f.familia}'` : f.familia;
  return f.categoria.startsWith('serif') ? `${nombre}, Georgia, serif` : `${nombre}, system-ui, sans-serif`;
}

/** Peso más cercano que la fuente tiene (una fuente de un solo peso siempre devuelve ese). */
export function pesoDisponible(f: FuenteCatalogo, deseado: number): number {
  const pesos = f.pesos.length > 0 ? f.pesos : [400];
  if (f.variable) {
    const min = pesos[0] ?? 400;
    const max = pesos.at(-1) ?? 400;
    return Math.min(max, Math.max(min, deseado));
  }
  return pesos.reduce((mejor, p) => (Math.abs(p - deseado) < Math.abs(mejor - deseado) ? p : mejor), pesos[0] ?? 400);
}

/** Texto corto para avisar al editor cuando el peso elegido no existe tal cual. */
export function descripcionPesos(f: FuenteCatalogo): string {
  if (f.pesos.length <= 1) return `${f.pesos[0] ?? 400} (único)`;
  return f.variable ? `${f.pesos[0]} a ${f.pesos.at(-1)}` : f.pesos.join(', ');
}

export type FuentesElegidas = { titulos: FuenteCatalogo; texto: FuenteCatalogo };

/**
 * Fuentes efectivas a partir de `typography` (capas de menor a mayor prioridad, como `resolverTipografia`).
 * Con `heading_font`/`body_font` válidos del catálogo se usan; si no, la pareja (`pair`).
 * Esta es la función que la tienda debe llamar para saber qué fuentes cargar.
 */
export function resolverFuentes(...capas: (Record<string, unknown> | null | undefined)[]): FuentesElegidas {
  const par = resolverTipografia(...capas).par;
  const pareja = PARES_TIPOGRAFICOS.find((p) => p.id === par) ?? PARES_TIPOGRAFICOS[0]!;
  let titulos = fuentePorFamilia(pareja.titulos);
  let texto = fuentePorFamilia(pareja.texto);
  // Las fuentes explícitas de una capa más específica ganan a las de una capa anterior.
  for (const capa of capas) {
    if (!capa || typeof capa !== 'object') continue;
    titulos = fuentePorFamilia(capa['heading_font']) ?? titulos;
    texto = fuentePorFamilia(capa['body_font']) ?? texto;
  }
  return { titulos: titulos ?? FUENTES_CATALOGO[0]!, texto: texto ?? FUENTES_CATALOGO[0]! };
}

/** Número de pareja curada (1–6) si las dos fuentes coinciden con una; `null` si no. */
export function parejaDe(titulos: string, texto: string): number | null {
  return PARES_TIPOGRAFICOS.find((p) => p.titulos === titulos && p.texto === texto)?.id ?? null;
}
