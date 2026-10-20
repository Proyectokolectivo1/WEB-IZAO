/** Contraste WCAG 2.x entre colores hex. Sin dependencias. */

function canal(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function hexARgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminancia(hex: string): number {
  const rgb = hexARgb(hex);
  if (!rgb) throw new Error(`Color hex inválido: ${hex}`);
  return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
}

/** Relación de contraste 1–21. */
export function ratioContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [alto, bajo] = la >= lb ? [la, lb] : [lb, la];
  return (alto + 0.05) / (bajo + 0.05);
}

/** Umbrales AA: texto normal 4.5, texto grande (≥ 18 px o 14 px negrita) 3, componentes gráficos 3. */
export type UsoTexto = 'cuerpo' | 'grande' | 'decorativo';
export const UMBRAL_AA: Readonly<Record<UsoTexto, number>> = { cuerpo: 4.5, grande: 3, decorativo: 0 };

export interface CombinacionTema {
  readonly texto: string;
  readonly fondo: string;
  readonly uso: UsoTexto;
  readonly descripcion: string;
}

export interface ResultadoContraste extends CombinacionTema {
  readonly ratio: number;
  readonly cumple: boolean;
  /** El panel debe advertir cuando una combinación de texto baja de 4.5:1 aunque sea de uso grande. */
  readonly advertencia: boolean;
}

/** Combinaciones texto/fondo de §8.1 (color de texto → fondo). */
export function combinacionesDeTexto(c: Record<string, string>): CombinacionTema[] {
  return [
    { texto: c['ink']!, fondo: c['bg']!, uso: 'cuerpo', descripcion: 'Texto principal sobre fondo' },
    { texto: c['ink']!, fondo: c['surface']!, uso: 'cuerpo', descripcion: 'Texto principal sobre superficie' },
    { texto: c['bg']!, fondo: c['ink']!, uso: 'cuerpo', descripcion: 'Botón primario, header y footer' },
    { texto: c['bg']!, fondo: c['ink-hover']!, uso: 'cuerpo', descripcion: 'Botón primario en hover' },
    { texto: c['muted']!, fondo: c['bg']!, uso: 'grande', descripcion: 'Texto secundario (solo ≥ 18 px)' },
    { texto: c['ink']!, fondo: c['accent']!, uso: 'cuerpo', descripcion: 'Etiquetas suaves (texto de tinta sobre acento)' },
    { texto: c['bg']!, fondo: c['success']!, uso: 'cuerpo', descripcion: 'Estado positivo' },
    { texto: c['bg']!, fondo: c['danger']!, uso: 'cuerpo', descripcion: 'Error o agotado' },
    { texto: c['accent']!, fondo: c['bg']!, uso: 'decorativo', descripcion: 'Acento sobre fondo (nunca como texto)' },
  ];
}

export function evaluarContrastes(combos: readonly CombinacionTema[]): ResultadoContraste[] {
  return combos.map((c) => {
    const ratio = ratioContraste(c.texto, c.fondo);
    return {
      ...c,
      ratio,
      cumple: ratio >= UMBRAL_AA[c.uso],
      advertencia: c.uso !== 'cuerpo' && ratio < UMBRAL_AA.cuerpo,
    };
  });
}
