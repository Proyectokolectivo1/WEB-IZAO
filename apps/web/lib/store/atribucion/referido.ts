/**
 * Referido en el navegador (§17.2): el código de `?ref=` que dejó el middleware en la cookie `izao_ref` se aplica
 * solo en el bolso y el checkout. Si la persona lo quita a propósito, no se vuelve a poner en esa sesión (la
 * atribución al influencer sigue en la cookie: lo que se descarta es el descuento, no el origen de la visita).
 */
import { COOKIE_REF, normalizarRef, parsearCookies } from './captura';

const claveDescartado = (pais: string) => `izao:ref-descartado:${pais}`;

/** Código de referido que aún se puede aplicar solo, o `null`. */
export function referidoParaAplicar(pais: string): string | null {
  try {
    const crudo = parsearCookies(document.cookie)[COOKIE_REF];
    const ref = normalizarRef(crudo ? decodeURIComponent(crudo) : null);
    if (!ref) return null;
    return window.sessionStorage.getItem(claveDescartado(pais)) === ref ? null : ref;
  } catch {
    return null;
  }
}

/** La persona quitó el código: no se vuelve a aplicar solo en esta sesión. */
export function descartarReferido(pais: string, codigo: string): void {
  try {
    if (normalizarRef(codigo)) window.sessionStorage.setItem(claveDescartado(pais), codigo);
  } catch {
    /* sin almacenamiento: puede volver a aplicarse al recargar */
  }
}
