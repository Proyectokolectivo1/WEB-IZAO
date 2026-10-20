import {
  BASE_MAX_PX,
  BASE_MIN_PX,
  CLAVES_COLOR,
  COLORES_POR_DEFECTO,
  LINEA_POR_DEFECTO,
  PARES_TIPOGRAFICOS,
  TIPOGRAFIA_POR_DEFECTO,
  type ClaveColor,
  type TipografiaTema,
} from './defaults';

type Json = Record<string, unknown> | null | undefined;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOR_FUNCION = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const EM = /^-?\d{1,2}(?:\.\d{1,3})?em$/;

/** Acepta `color-bg`, `--color-bg` o `bg`. */
function normalizarClave(k: string): string {
  return k.replace(/^--/, '').replace(/^color-/, '');
}

export interface TemaColores {
  readonly colores: Readonly<Record<ClaveColor, string>>;
  /** Solo si el panel fijó un valor explícito para el divisor. */
  readonly linea: string | null;
}

/** Aplica, en orden, las capas sobre los valores por defecto. Valores inválidos se ignoran. */
export function resolverColores(...capas: Json[]): TemaColores {
  const colores: Record<ClaveColor, string> = { ...COLORES_POR_DEFECTO };
  let linea: string | null = null;
  for (const capa of capas) {
    if (!capa || typeof capa !== 'object') continue;
    for (const [claveCruda, valor] of Object.entries(capa)) {
      if (typeof valor !== 'string') continue;
      const clave = normalizarClave(claveCruda);
      const v = valor.trim();
      if (clave === 'line') {
        if (HEX.test(v) || COLOR_FUNCION.test(v)) linea = v;
        continue;
      }
      if ((CLAVES_COLOR as readonly string[]).includes(clave) && HEX.test(v)) {
        colores[clave as ClaveColor] = v.toUpperCase();
      }
    }
  }
  return { colores, linea };
}

function entero(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Lee la tipografía de `site_settings.typography` (y del override por país).
 * Claves: `pair` (1–6), `base_size_px` (15–18), `heading_weight`, `heading_letter_spacing`, `label_letter_spacing`.
 */
export function resolverTipografia(...capas: Json[]): TipografiaTema {
  let t: TipografiaTema = { ...TIPOGRAFIA_POR_DEFECTO };
  for (const capa of capas) {
    if (!capa || typeof capa !== 'object') continue;
    const par = entero(capa['pair']);
    if (par !== null && PARES_TIPOGRAFICOS.some((p) => p.id === par)) t = { ...t, par: par as TipografiaTema['par'] };
    const base = entero(capa['base_size_px']);
    if (base !== null) t = { ...t, baseSizePx: Math.min(BASE_MAX_PX, Math.max(BASE_MIN_PX, base)) };
    const peso = entero(capa['heading_weight']);
    if (peso !== null && peso >= 300 && peso <= 800) t = { ...t, pesoTitulos: Math.round(peso / 100) * 100 };
    const eh = capa['heading_letter_spacing'];
    if (typeof eh === 'string' && EM.test(eh.trim())) t = { ...t, espaciadoTitulos: eh.trim() };
    const el = capa['label_letter_spacing'];
    if (typeof el === 'string' && EM.test(el.trim())) t = { ...t, espaciadoEtiquetas: el.trim() };
  }
  return t;
}

/**
 * Bloque `:root{…}` con todos los tokens. Se inyecta en el servidor, así que no hay parpadeo.
 * `--font-display` y `--font-body` apuntan a las variables que define `next/font` para la pareja elegida
 * (`--font-par{N}-titulos`, `--font-par{N}-texto`).
 */
export function construirCssTema(colores: TemaColores, tipo: TipografiaTema): string {
  const lineas: string[] = [];
  for (const k of CLAVES_COLOR) lineas.push(`--color-${k}:${colores.colores[k]}`);
  lineas.push(`--color-line:${colores.linea ?? LINEA_POR_DEFECTO}`);
  lineas.push(`--font-display:var(--font-par${tipo.par}-titulos),Georgia,serif`);
  lineas.push(`--font-body:var(--font-par${tipo.par}-texto),system-ui,sans-serif`);
  lineas.push(`--tema-base:${tipo.baseSizePx}px`);
  lineas.push(`--tema-peso-titulos:${tipo.pesoTitulos}`);
  lineas.push(`--tema-espaciado-titulos:${tipo.espaciadoTitulos}`);
  lineas.push(`--tema-espaciado-etiquetas:${tipo.espaciadoEtiquetas}`);
  return `:root{${lineas.join(';')}}`;
}
