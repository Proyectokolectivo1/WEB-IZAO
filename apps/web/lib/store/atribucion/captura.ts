/**
 * Atribución de la venta (§17.2, §21): enlace de referido `?ref=CODIGO` y origen de la visita (UTM y click IDs de
 * anuncios). Código puro (sin Next ni navegador) para que el borde de la tienda (middleware), el carrito y el
 * servidor del checkout lean exactamente lo mismo.
 *
 * Cookies (30 días, `SameSite=Lax`, `Path=/`):
 *  - `izao_ref`  CODIGO en mayúsculas. Legible por el navegador (el carrito aplica el código solo).
 *  - `izao_utm`  JSON URL-encoded `{ utm_source, utm_medium, utm_campaign, utm_term, utm_content }`. HttpOnly.
 *  - `izao_clk`  JSON URL-encoded `{ fbclid, gclid, ttclid }`. HttpOnly.
 * Una visita nueva con parámetros reemplaza lo anterior de su grupo (último toque).
 *
 * El servidor del checkout (izao-pagos) llama a `leerAtribucion(req.headers.get('cookie'))` y copia el resultado a
 * `orders.influencer_id` (vía `ref`), `orders.utm` y `orders.click_ids`; de ahí sale la columna generada
 * `orders.sale_source`. El navegador nunca decide esos campos: la cookie solo es una pista que el servidor valida.
 */

/** Vigencia de las tres cookies: 30 días (§17.2). */
export const VIGENCIA_ATRIBUCION_SEG = 30 * 24 * 60 * 60;

export const COOKIE_REF = 'izao_ref';
export const COOKIE_UTM = 'izao_utm';
export const COOKIE_CLICK_IDS = 'izao_clk';

export const CLAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
export const CLAVES_CLICK_IDS = ['fbclid', 'gclid', 'ttclid'] as const;
/** Todos los parámetros de la URL que dispara la captura (también los reenvía la raíz `/`). */
export const PARAMETROS_ATRIBUCION = ['ref', ...CLAVES_UTM, ...CLAVES_CLICK_IDS] as const;

export type ClaveUtm = (typeof CLAVES_UTM)[number];
export type ClaveClickId = (typeof CLAVES_CLICK_IDS)[number];

const MAX_UTM = 100;
const MAX_CLICK_ID = 300;
const PATRON_REF = /^[A-Z0-9_-]{1,40}$/;
/** Parámetros de un anuncio: letras, números y signos de URL; se descarta lo que parezca marcado o control. */
const PATRON_VALOR = /^[\p{L}\p{N} _.,:;@/+()%=~-]+$/u;

export interface Atribucion {
  /** Código del enlace de referido, ya validado y en mayúsculas. */
  ref: string | null;
  utm: Partial<Record<ClaveUtm, string>>;
  clickIds: Partial<Record<ClaveClickId, string>>;
}

export const ATRIBUCION_VACIA: Atribucion = { ref: null, utm: {}, clickIds: {} };

export function normalizarRef(valor: string | null | undefined): string | null {
  const v = valor?.trim().toUpperCase() ?? '';
  return PATRON_REF.test(v) ? v : null;
}

function limpiar(valor: string | null | undefined, max: number): string | null {
  const v = valor?.trim() ?? '';
  if (!v || v.length > max || !PATRON_VALOR.test(v)) return null;
  return v;
}

/** Lo que trae la URL de la visita. Los valores inválidos se ignoran sin error. */
export function extraerAtribucion(params: URLSearchParams): Atribucion {
  const utm: Atribucion['utm'] = {};
  for (const k of CLAVES_UTM) {
    const v = limpiar(params.get(k), MAX_UTM);
    if (v) utm[k] = v;
  }
  const clickIds: Atribucion['clickIds'] = {};
  for (const k of CLAVES_CLICK_IDS) {
    const v = limpiar(params.get(k), MAX_CLICK_ID);
    if (v) clickIds[k] = v;
  }
  return { ref: normalizarRef(params.get('ref')), utm, clickIds };
}

export function hayAtribucion(a: Atribucion): boolean {
  return a.ref !== null || Object.keys(a.utm).length > 0 || Object.keys(a.clickIds).length > 0;
}

function leerJson<K extends string>(crudo: string | undefined, claves: readonly K[], max: number): Partial<Record<K, string>> {
  const salida: Partial<Record<K, string>> = {};
  if (!crudo) return salida;
  try {
    const obj: unknown = JSON.parse(decodeURIComponent(crudo));
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return salida;
    for (const k of claves) {
      const v = limpiar((obj as Record<string, unknown>)[k] as string | undefined, max);
      if (v) salida[k] = v;
    }
  } catch {
    /* cookie alterada o truncada: se ignora */
  }
  return salida;
}

/** Valor de las cookies `izao_utm` / `izao_clk` (JSON). `cookies.set` de Next lo codifica al enviarlo; no codificar dos veces. */
export const serializarUtm = (utm: Atribucion['utm']): string => JSON.stringify(utm);
export const serializarClickIds = (c: Atribucion['clickIds']): string => JSON.stringify(c);

/** Cookies de un encabezado `Cookie` (o `document.cookie`) → mapa nombre → valor sin decodificar. */
export function parsearCookies(encabezado: string | null | undefined): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const trozo of (encabezado ?? '').split(';')) {
    const i = trozo.indexOf('=');
    if (i < 1) continue;
    const nombre = trozo.slice(0, i).trim();
    if (!(nombre in salida)) salida[nombre] = trozo.slice(i + 1).trim();
  }
  return salida;
}

/**
 * Lectura para el servidor del checkout. Todo se revalida: una cookie manipulada solo puede producir un `ref` que
 * el servidor comprobará contra `discount_codes`, y textos acotados para `utm` y `click_ids`.
 * `utm` y `click_ids` salen listos para `orders.utm` y `orders.click_ids` (objetos vacíos si no hay).
 */
export function leerAtribucion(encabezadoCookie: string | null | undefined): {
  ref: string | null;
  utm: Record<string, string>;
  click_ids: Record<string, string>;
} {
  const c = parsearCookies(encabezadoCookie);
  let ref: string | null = null;
  try {
    ref = normalizarRef(c[COOKIE_REF] ? decodeURIComponent(c[COOKIE_REF]) : null);
  } catch {
    ref = null;
  }
  return {
    ref,
    utm: leerJson(c[COOKIE_UTM], CLAVES_UTM, MAX_UTM),
    click_ids: leerJson(c[COOKIE_CLICK_IDS], CLAVES_CLICK_IDS, MAX_CLICK_ID),
  };
}

/** Código de referido guardado en el navegador (`document.cookie`), o `null`. */
export function leerRefDeCookies(encabezado: string | null | undefined): string | null {
  return leerAtribucion(encabezado).ref;
}
