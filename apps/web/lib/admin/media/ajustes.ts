/**
 * Ajustes de subida de imágenes (regla 3: nada configurable va quemado). Código puro compartido por el servidor, el
 * panel y las pruebas. Los valores por defecto son los del seed; la base manda cuando el campo
 * `site_settings.media_settings` existe (ver «Pendiente» de la bitácora: lo crea izao-db).
 */
export const CALIDAD_WEBP_POR_DEFECTO = 80;

export type AjustesMedia = {
  /** Calidad WebP 50–95. */
  calidad: number;
  /** Peso máximo de una imagen subida, en MB (1–25). */
  maxMb: number;
};

export const CALIDAD_MIN = 50;
export const CALIDAD_MAX = 95;
export const MAX_MB_MIN = 1;
export const MAX_MB_MAX = 25;
export const MAX_MB_POR_DEFECTO = 15;

export const AJUSTES_MEDIA_POR_DEFECTO: AjustesMedia = Object.freeze({
  calidad: CALIDAD_WEBP_POR_DEFECTO,
  maxMb: MAX_MB_POR_DEFECTO,
});

function entero(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

/** Lee `{ webp_quality, max_mb }` de la base; lo que falte o esté fuera de rango toma el valor por defecto. */
export function normalizarAjustesMedia(crudo: unknown): AjustesMedia {
  const o = crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? (crudo as Record<string, unknown>) : {};
  const calidad = entero(o['webp_quality']);
  const maxMb = entero(o['max_mb']);
  return {
    calidad: calidad !== null && calidad >= CALIDAD_MIN && calidad <= CALIDAD_MAX ? calidad : AJUSTES_MEDIA_POR_DEFECTO.calidad,
    maxMb: maxMb !== null && maxMb >= MAX_MB_MIN && maxMb <= MAX_MB_MAX ? maxMb : AJUSTES_MEDIA_POR_DEFECTO.maxMb,
  };
}

/** Valida lo que escribe la persona; devuelve errores por campo. */
export function validarAjustesMedia(entrada: { calidad: string; maxMb: string }):
  | { ok: true; ajustes: AjustesMedia }
  | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const calidad = entero(entrada.calidad);
  const maxMb = entero(entrada.maxMb);
  if (calidad === null || calidad < CALIDAD_MIN || calidad > CALIDAD_MAX) {
    errores.calidad = `La calidad debe estar entre ${CALIDAD_MIN} y ${CALIDAD_MAX}.`;
  }
  if (maxMb === null || maxMb < MAX_MB_MIN || maxMb > MAX_MB_MAX) {
    errores.maxMb = `El peso máximo debe estar entre ${MAX_MB_MIN} y ${MAX_MB_MAX} MB.`;
  }
  if (Object.keys(errores).length > 0 || calidad === null || maxMb === null) return { ok: false, errores };
  return { ok: true, ajustes: { calidad, maxMb } };
}

/** Texto de la base: `{ webp_quality, max_mb }`. */
export function ajustesAJson(a: AjustesMedia): Record<string, number> {
  return { webp_quality: a.calidad, max_mb: a.maxMb };
}

export const bytesMaximos = (a: AjustesMedia): number => a.maxMb * 1024 * 1024;
