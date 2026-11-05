/**
 * Apariencia (§8, §24.1): colores con verificación de contraste, tipografía, logo y favicon, globales o con
 * *override* por país. Código puro compartido por el formulario, las Server Actions y las pruebas. La resolución
 * de colores y tipografía y los contrastes WCAG viven en `@izao/ui/tema` (los mismos que usa la tienda), así que lo que
 * se previsualiza es exactamente lo que se aplica.
 */
import { z } from 'zod';
import {
  BASE_MAX_PX,
  BASE_MIN_PX,
  CLAVES_COLOR,
  PARES_TIPOGRAFICOS,
  combinacionesDeTexto,
  evaluarContrastes,
  hexARgb,
  resolverColores,
  resolverTipografia,
  type ClaveColor,
  type ResultadoContraste,
} from '@izao/ui/tema';
import { fuentePorFamilia, parejaDe } from '../../tipografia/catalogo';

export type Alcance = 'global' | 'CO' | 'EC';
export const ALCANCES: readonly Alcance[] = ['global', 'CO', 'EC'];
export const ETIQUETA_ALCANCE: Record<Alcance, string> = { global: 'Todo el sitio', CO: 'Colombia', EC: 'Ecuador' };

export function leerAlcance(v: string | string[] | undefined): Alcance {
  const x = (Array.isArray(v) ? v[0] : v)?.toUpperCase();
  return x === 'CO' || x === 'EC' ? x : 'global';
}

export const ETIQUETA_COLOR: Record<ClaveColor, { nombre: string; uso: string }> = {
  bg: { nombre: 'Fondo', uso: 'Fondo principal de la tienda' },
  surface: { nombre: 'Superficie', uso: 'Secciones alternas, chips y tarjetas' },
  accent: { nombre: 'Acento', uso: 'Solo decorativo; nunca como color de texto' },
  muted: { nombre: 'Texto secundario', uso: 'Solo texto de 18 px o más, íconos y bordes' },
  ink: { nombre: 'Tinta', uso: 'Texto principal, botones primarios, header y footer' },
  'ink-hover': { nombre: 'Tinta (hover)', uso: 'Botón primario al pasar el cursor' },
  success: { nombre: 'Positivo', uso: 'Estados positivos' },
  danger: { nombre: 'Error', uso: 'Errores y agotado' },
};

export const PESOS_TITULOS = [300, 400, 500, 600, 700, 800] as const;
const EM = /^-?\d{1,2}(?:\.\d{1,3})?em$/;

/** `#abc` → `#AABBCC`; `null` si no es un hex válido. */
export function normalizarHex(valor: string): string | null {
  const v = valor.trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || !hexARgb(v)) return null;
  const sin = v.slice(1);
  const largo = sin.length === 3 ? [...sin].map((c) => c + c).join('') : sin;
  return `#${largo.toUpperCase()}`;
}

// ── Entrada del formulario ───────────────────────────────────────────────────────────────────────

export type DatosApariencia = {
  alcance: Alcance;
  /** Global: los 8 colores. País: solo los que se cambian (`null` = hereda). */
  colores: Record<ClaveColor, string | null>;
  tipografia: {
    /** Pareja curada 1–6 si las dos fuentes coinciden con una; `null` si no (o si el país hereda). */
    pair: number | null;
    /** Familia de Google Fonts del catálogo (`lib/tipografia/catalogo.ts`). */
    heading_font: string | null;
    body_font: string | null;
    base_size_px: number | null;
    heading_weight: number | null;
    heading_letter_spacing: string | null;
    label_letter_spacing: string | null;
  };
  store_name: string | null;
  logo_media_id: string | null;
  favicon_media_id: string | null;
  /** La persona vio la advertencia de contraste y aun así quiere guardar. */
  acepto_contraste: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Esquema del formulario. En el global los colores son obligatorios; en un país, vacío = heredar. */
export function esquemaApariencia(alcance: Alcance) {
  const global = alcance === 'global';
  const color = z
    .string()
    .trim()
    .default('')
    .transform((v, ctx): string | null => {
      if (v === '') {
        if (global) ctx.addIssue({ code: 'custom', message: 'Elige un color.' });
        return null;
      }
      const hex = normalizarHex(v);
      if (!hex) ctx.addIssue({ code: 'custom', message: 'Usa un color como #382E2B.' });
      return hex;
    });
  const fuente = z
    .string()
    .trim()
    .default('')
    .transform((v, ctx): string | null => {
      if (v === '') return null;
      if (!fuentePorFamilia(v)) ctx.addIssue({ code: 'custom', message: 'Elige una tipografía de la lista.' });
      return v;
    });
  const entero = (min: number, max: number, etiqueta: string) =>
    z
      .string()
      .trim()
      .default('')
      .transform((v, ctx): number | null => {
        if (v === '') {
          if (global) ctx.addIssue({ code: 'custom', message: `${etiqueta} es obligatorio.` });
          return null;
        }
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || n > max) {
          ctx.addIssue({ code: 'custom', message: `${etiqueta} debe estar entre ${min} y ${max}.` });
          return null;
        }
        return n;
      });
  const espaciado = (etiqueta: string) =>
    z
      .string()
      .trim()
      .default('')
      .transform((v, ctx): string | null => {
        if (v === '') {
          if (global) ctx.addIssue({ code: 'custom', message: `${etiqueta} es obligatorio.` });
          return null;
        }
        if (!EM.test(v)) ctx.addIssue({ code: 'custom', message: 'Usa un valor en em, como 0.02em.' });
        return v;
      });
  const media = z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || UUID.test(v), 'Imagen no válida.')
    .transform((v) => (v === '' ? null : v));

  return z
    .object({
      color_bg: color,
      color_surface: color,
      color_accent: color,
      color_muted: color,
      color_ink: color,
      color_ink_hover: color,
      color_success: color,
      color_danger: color,
      // `pair` solo se acepta como atajo (formularios anteriores): equivale a elegir las dos fuentes de esa pareja.
      pair: z
        .string()
        .trim()
        .default('')
        .transform((v, ctx): number | null => {
          if (v === '') return null;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > PARES_TIPOGRAFICOS.length) {
            ctx.addIssue({ code: 'custom', message: `La pareja debe estar entre 1 y ${PARES_TIPOGRAFICOS.length}.` });
            return null;
          }
          return n;
        }),
      heading_font: fuente,
      body_font: fuente,
      base_size_px: entero(BASE_MIN_PX, BASE_MAX_PX, 'El tamaño base'),
      heading_weight: entero(300, 800, 'El peso de los títulos').refine((n) => n === null || n % 100 === 0, 'Usa 300, 400, 500, 600, 700 u 800.'),
      heading_letter_spacing: espaciado('El espaciado de títulos'),
      label_letter_spacing: espaciado('El espaciado de etiquetas'),
      store_name: z
        .string()
        .trim()
        .max(80, 'Máximo 80 caracteres.')
        .default('')
        .transform((v) => (v === '' ? null : v)),
      logo_media_id: media,
      favicon_media_id: media,
      acepto_contraste: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
    })
    .superRefine((d, ctx) => {
      if (!global) return;
      const par = d.pair !== null ? PARES_TIPOGRAFICOS.find((p) => p.id === d.pair) : undefined;
      if (!(d.heading_font ?? par?.titulos)) ctx.addIssue({ code: 'custom', path: ['heading_font'], message: 'Elige la tipografía de los títulos.' });
      if (!(d.body_font ?? par?.texto)) ctx.addIssue({ code: 'custom', path: ['body_font'], message: 'Elige la tipografía del texto.' });
    })
    .transform(
      (d): DatosApariencia => {
        const par = d.pair !== null ? PARES_TIPOGRAFICOS.find((p) => p.id === d.pair) : undefined;
        const titulos = d.heading_font ?? par?.titulos ?? null;
        const texto = d.body_font ?? par?.texto ?? null;
        return {
        alcance,
        colores: {
          bg: d.color_bg,
          surface: d.color_surface,
          accent: d.color_accent,
          muted: d.color_muted,
          ink: d.color_ink,
          'ink-hover': d.color_ink_hover,
          success: d.color_success,
          danger: d.color_danger,
        },
        tipografia: {
          pair: titulos && texto ? parejaDe(titulos, texto) : null,
          heading_font: titulos,
          body_font: texto,
          base_size_px: d.base_size_px,
          heading_weight: d.heading_weight,
          heading_letter_spacing: d.heading_letter_spacing,
          label_letter_spacing: d.label_letter_spacing,
        },
        store_name: d.store_name,
        logo_media_id: d.logo_media_id,
        favicon_media_id: d.favicon_media_id,
        acepto_contraste: d.acepto_contraste,
        };
      },
    ) as unknown as z.ZodType<DatosApariencia, unknown>;
}

// ── Contraste ────────────────────────────────────────────────────────────────────────────────────

/** Colores efectivos: el global (o el de fábrica) con los del país encima. */
export function coloresEfectivos(base: Record<string, unknown> | null, cambios: Partial<Record<ClaveColor, string | null>>): Record<ClaveColor, string> {
  const capa: Record<string, string> = {};
  for (const [k, v] of Object.entries(cambios)) if (v) capa[k] = v;
  return { ...resolverColores(base, capa).colores };
}

export function contrastesDe(colores: Record<ClaveColor, string>): ResultadoContraste[] {
  return evaluarContrastes(combinacionesDeTexto(colores));
}

/** Combinaciones de texto de cuerpo que no llegan a AA (4.5:1). Las de texto grande y decorativas solo advierten. */
export function fallosGraves(resultados: readonly ResultadoContraste[]): ResultadoContraste[] {
  return resultados.filter((r) => r.uso === 'cuerpo' && !r.cumple);
}

// ── Qué se guarda ────────────────────────────────────────────────────────────────────────────────

/** `site_settings.color_tokens`: se conservan las claves que el formulario no toca (p. ej. `color-line`). */
export function tokensGlobales(previo: Record<string, unknown> | null, colores: Record<ClaveColor, string | null>): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...(previo ?? {}) };
  for (const k of CLAVES_COLOR) {
    const v = colores[k];
    if (v) {
      salida[`color-${k}`] = v;
      delete salida[`--color-${k}`];
      delete salida[k];
    }
  }
  return salida;
}

/** `site_settings.typography` (y el nombre de las fuentes de la pareja, que el seed también guarda). */
export function tipografiaGlobal(previo: Record<string, unknown> | null, t: DatosApariencia['tipografia']): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...(previo ?? {}) };
  // `pair` solo se toca si las dos fuentes forman una pareja curada: así la tienda anterior sigue viendo algo coherente.
  if (t.pair !== null) salida.pair = t.pair;
  if (t.heading_font !== null) salida.heading_font = t.heading_font;
  if (t.body_font !== null) salida.body_font = t.body_font;
  if (t.base_size_px !== null) salida.base_size_px = t.base_size_px;
  if (t.heading_weight !== null) salida.heading_weight = t.heading_weight;
  if (t.heading_letter_spacing !== null) salida.heading_letter_spacing = t.heading_letter_spacing;
  if (t.label_letter_spacing !== null) salida.label_letter_spacing = t.label_letter_spacing;
  return salida;
}

/** `theme_overrides.tokens`: solo lo que el país cambia; vacío = el país hereda todo. */
export function tokensDePais(d: Pick<DatosApariencia, 'colores' | 'tipografia'>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const k of CLAVES_COLOR) {
    const v = d.colores[k];
    if (v) salida[`color-${k}`] = v;
  }
  const tipo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.tipografia)) if (v !== null) tipo[k] = v;
  if (Object.keys(tipo).length > 0) salida.typography = tipo;
  return salida;
}

/** Valores del formulario a partir de lo guardado (para precargar). */
export function valoresIniciales(tokens: Record<string, unknown> | null, tipografia: Record<string, unknown> | null) {
  const c = resolverColores(tokens);
  const t = resolverTipografia(tipografia);
  return { colores: c.colores, tipografia: t };
}
