/**
 * Utilidades puras de los módulos CRUD del panel (sin servidor ni navegador):
 * slug, errores por campo, paginación en la URL y diff para la auditoría.
 */
import type { ZodError } from 'zod';

export type ErroresCampo = Record<string, string>;

/** Resultado de una Server Action de formulario. */
export type ResultadoAccion =
  | { ok: true; id?: string; mensaje?: string }
  | { ok: false; mensaje?: string; errores?: ErroresCampo };

export const ESTADO_INICIAL: ResultadoAccion = { ok: false };

/** `Perfumería Árabe` -> `perfumeria-arabe`. Solo [a-z0-9-], sin guiones al borde. */
export function slugificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export const PATRON_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Primer mensaje por campo; la ruta anidada se une con punto (`variantes.0.sku`). */
export function erroresPorCampo(error: ZodError): ErroresCampo {
  const salida: ErroresCampo = {};
  for (const issue of error.issues) {
    const clave = issue.path.map(String).join('.') || 'form';
    if (!(clave in salida)) salida[clave] = issue.message;
  }
  return salida;
}

export const TAMANO_PAGINA = 25;

export type ParametrosLista = { q: string; pagina: number };

type Buscables = Record<string, string | string[] | undefined>;

function primero(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** Lee `?q=` y `?page=` de la URL con valores seguros. */
export function leerParametrosLista(sp: Buscables): ParametrosLista {
  const q = primero(sp.q).trim().slice(0, 100);
  const n = Number.parseInt(primero(sp.page), 10);
  const pagina = Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1;
  return { q, pagina };
}

/** Rango inclusivo `[desde, hasta]` para `.range()` de Supabase. */
export function rangoPagina(pagina: number, tamano = TAMANO_PAGINA): [number, number] {
  return [(pagina - 1) * tamano, pagina * tamano - 1];
}

/** Escapa `\`, `%` y `_` para usar el texto dentro de un `ilike` (un solo filtro, nunca `.or()`). */
export function escaparBusqueda(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Diff antes/después solo con los campos que cambian (para `audit_log`). */
export function diffCampos(
  antes: Record<string, unknown> | null | undefined,
  despues: Record<string, unknown>,
): { antes: Record<string, unknown>; despues: Record<string, unknown> } {
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  for (const clave of Object.keys(despues)) {
    const previo = antes?.[clave];
    if (JSON.stringify(previo ?? null) !== JSON.stringify(despues[clave] ?? null)) {
      a[clave] = previo ?? null;
      d[clave] = despues[clave] ?? null;
    }
  }
  return { antes: a, despues: d };
}

/** Texto vacío -> null (para columnas opcionales). */
export function nulaSiVacio(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}
