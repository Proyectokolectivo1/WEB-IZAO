import { esPais } from './pais';
import type { CodigoPais } from './types';

/** Cookie que ya usan `/` y `/{país}/cambiar-pais`; la ventana de sede la lee y la escribe igual. */
export const COOKIE_PAIS = 'country';
/** Copia en `localStorage` por si el navegador borra la cookie. */
export const CLAVE_SEDE = 'izao:sede';
/** Evento que abre la ventana a mano (cabecera, pie). */
export const EVENTO_ABRIR_SEDE = 'izao:abrir-sede';
const UN_ANO = 60 * 60 * 24 * 365;
/**
 * Cuándo sale la ventana en la primera visita. Un elemento grande que aparece tarde pasa a ser el LCP de la página y
 * lo empeora (medido: 2,6 s → 3,2 s), pero el LCP se cierra con la primera interacción: por eso sale unos instantes
 * después de la primera interacción (tocar, teclear o desplazar) o, si la persona solo mira, tras `RETARDO_SEDE_MS`.
 */
export const RETARDO_SEDE_MS = 6000;
export const RETARDO_TRAS_INTERACCION_MS = 400;

export interface OpcionSede {
  pais: CodigoPais;
  nombre: string;
  moneda: string;
  envio: string;
  pago: string;
}

/** Rutas donde la ventana nunca sale: la compra y el seguimiento ya están en curso. */
const RUTAS_SIN_VENTANA = /^\/(?:co|ec)\/(?:pagar|pedido|checkout)(?:\/|$)/i;
const ES_ROBOT = /bot|crawl|spider|slurp|lighthouse|pagespeed|facebookexternalhit/i;

export function debeMostrarSede(entrada: { ruta: string; cookiePais: string | null; guardado: string | null; agente: string }): boolean {
  if (RUTAS_SIN_VENTANA.test(entrada.ruta)) return false;
  if (ES_ROBOT.test(entrada.agente)) return false;
  if (esPais(entrada.cookiePais?.toLowerCase()) || esPais(entrada.guardado?.toLowerCase())) return false;
  return true;
}

export function leerCookie(documento: Pick<Document, 'cookie'>, nombre: string): string | null {
  for (const parte of documento.cookie.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Guarda la elección (cookie y `localStorage`); cada escritura va protegida: puede estar bloqueada. */
export function recordarSede(pais: CodigoPais): void {
  try {
    document.cookie = `${COOKIE_PAIS}=${pais}; path=/; max-age=${UN_ANO}; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
  } catch {
    /* sin cookies: queda localStorage */
  }
  try {
    localStorage.setItem(CLAVE_SEDE, pais);
  } catch {
    /* almacenamiento bloqueado */
  }
}

export function sedeRecordada(): { cookiePais: string | null; guardado: string | null } {
  let guardado: string | null = null;
  try {
    guardado = localStorage.getItem(CLAVE_SEDE);
  } catch {
    /* almacenamiento bloqueado */
  }
  return { cookiePais: leerCookie(document, COOKIE_PAIS), guardado };
}
