/**
 * Consentimiento de cookies de la tienda (§23.2: los píxeles de marketing cargan solo tras aceptar).
 *
 * La decisión vive en una cookie propia de primera parte (`izao_consent`, sin datos personales: solo dos interruptores y la
 * fecha) con copia en `localStorage` por si el navegador borra la cookie. Duración: 12 meses; pasado ese tiempo se vuelve a
 * preguntar. Categorías: las necesarias van siempre; `analitica` (GA4 y similares) y `marketing` (Meta Pixel, TikTok) solo con
 * un sí explícito. Sin decisión es lo mismo que «no»: opt-in estricto.
 *
 * Este módulo es puro y sin React: recibe el documento y el almacenamiento, así se prueba sin navegador. El enganche con React
 * (`useSyncExternalStore`) está en `components/store/cookies/useConsentimiento.ts`.
 */

export const COOKIE_CONSENTIMIENTO = 'izao_consent';
/** Copia en `localStorage`. */
export const CLAVE_CONSENTIMIENTO = 'izao:consent';
/** Evento (en `window`) que avisa a los componentes de la misma pestaña cuando cambia la decisión. */
export const EVENTO_CONSENTIMIENTO = 'izao:consentimiento';
/** Evento que abre la ventana de preferencias (enlace «Cookies» del pie). */
export const EVENTO_ABRIR_COOKIES = 'izao:abrir-cookies';
/** 12 meses en segundos (duración de la cookie y vigencia de la decisión). */
export const DURACION_SEGUNDOS = 60 * 60 * 24 * 365;
/** Variable CSS (en `<html>`) con el alto del aviso, para que los botones flotantes se coloquen por encima. */
export const VARIABLE_ALTO_AVISO = '--alto-aviso-cookies';

export interface Consentimiento {
  analitica: boolean;
  marketing: boolean;
  /** Segundos desde 1970 en que se tomó la decisión. */
  fecha: number;
}

export type Elecciones = Pick<Consentimiento, 'analitica' | 'marketing'>;

/** `v1.a0.m1.t1732400000` */
const FORMATO = /^v1\.a([01])\.m([01])\.t(\d{9,11})$/;

export function serializar(c: Consentimiento): string {
  return `v1.a${c.analitica ? 1 : 0}.m${c.marketing ? 1 : 0}.t${Math.floor(c.fecha)}`;
}

/** Texto → decisión vigente, o `null` si no es válido, es del futuro lejano o ya pasaron 12 meses. */
export function interpretar(valor: string | null | undefined, ahoraSegundos: number = Math.floor(Date.now() / 1000)): Consentimiento | null {
  const m = typeof valor === 'string' ? FORMATO.exec(valor.trim()) : null;
  if (!m) return null;
  const fecha = Number(m[3]);
  if (ahoraSegundos - fecha > DURACION_SEGUNDOS) return null;
  // Un reloj desajustado no debe volver eterna la decisión: no se acepta una fecha de más de un día adelante.
  if (fecha - ahoraSegundos > 60 * 60 * 24) return null;
  return { analitica: m[1] === '1', marketing: m[2] === '1', fecha };
}

/**
 * Para el SERVIDOR (checkout): ¿aceptó el marketing la persona que envía esta petición? Lee la cookie `izao_consent` de la
 * cabecera `Cookie`; sin cookie, vencida o manipulada es `false` (opt-in estricto). Sirve para guardar la decisión en el pedido
 * y que la API de Conversiones solo envíe el `Purchase` de quien aceptó.
 */
export function marketingAceptadoEnCabecera(cabeceraCookie: string | null | undefined, ahoraSegundos: number = Math.floor(Date.now() / 1000)): boolean {
  if (!cabeceraCookie) return false;
  for (const parte of cabeceraCookie.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE_CONSENTIMIENTO) return interpretar(v.join('='), ahoraSegundos)?.marketing === true;
  }
  return false;
}

export function leerCookie(documento: Pick<Document, 'cookie'>, nombre: string): string | null {
  try {
    for (const parte of documento.cookie.split(';')) {
      const [k, ...v] = parte.trim().split('=');
      if (k === nombre) return v.join('=');
    }
  } catch {
    /* cookies bloqueadas */
  }
  return null;
}

type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

export interface EntornoConsentimiento {
  documento: Pick<Document, 'cookie'>;
  almacen: Almacen | null;
  /** `https:` agrega `Secure` a la cookie. */
  seguro: boolean;
  ahoraSegundos: number;
}

/** Texto crudo de la decisión vigente (cookie primero, copia local después) o `''` si no hay. Sirve de instantánea estable. */
export function leerCrudo(e: Pick<EntornoConsentimiento, 'documento' | 'almacen' | 'ahoraSegundos'>): string {
  const deCookie = leerCookie(e.documento, COOKIE_CONSENTIMIENTO);
  if (interpretar(deCookie, e.ahoraSegundos)) return deCookie!;
  try {
    const local = e.almacen?.getItem(CLAVE_CONSENTIMIENTO) ?? null;
    if (interpretar(local, e.ahoraSegundos)) return local!;
  } catch {
    /* almacenamiento bloqueado */
  }
  return '';
}

export function leer(e: Pick<EntornoConsentimiento, 'documento' | 'almacen' | 'ahoraSegundos'>): Consentimiento | null {
  return interpretar(leerCrudo(e), e.ahoraSegundos);
}

/** Escribe cookie y copia local. Cada escritura va protegida: pueden estar bloqueadas. */
export function escribir(elecciones: Elecciones, e: EntornoConsentimiento): Consentimiento {
  const c: Consentimiento = { analitica: elecciones.analitica, marketing: elecciones.marketing, fecha: e.ahoraSegundos };
  const texto = serializar(c);
  try {
    (e.documento as { cookie: string }).cookie =
      `${COOKIE_CONSENTIMIENTO}=${texto}; path=/; max-age=${DURACION_SEGUNDOS}; samesite=lax${e.seguro ? '; secure' : ''}`;
  } catch {
    /* sin cookies: queda la copia local */
  }
  try {
    e.almacen?.setItem(CLAVE_CONSENTIMIENTO, texto);
  } catch {
    /* almacenamiento bloqueado */
  }
  return c;
}

/** Cookies de Meta que deja el Pixel; al retirar el consentimiento se borran de este sitio. */
export const COOKIES_META = ['_fbp', '_fbc'] as const;

/** Borra una cookie de primera parte en el dominio actual y, si aplica, en el dominio padre (`.dominio.com`). */
export function borrarCookie(nombre: string, documento: Pick<Document, 'cookie'>, host: string): void {
  const base = `${nombre}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  try {
    (documento as { cookie: string }).cookie = base;
    const partes = host.split('.');
    if (partes.length >= 2) (documento as { cookie: string }).cookie = `${base}; domain=.${partes.slice(-2).join('.')}`;
  } catch {
    /* nada que borrar */
  }
}

/* ---------- Capa del navegador (la usan el aviso y las pruebas e2e; sin React) ---------- */

function entornoNavegador(): EntornoConsentimiento | null {
  if (typeof window === 'undefined') return null;
  let almacen: Almacen | null = null;
  try {
    almacen = window.localStorage;
  } catch {
    almacen = null;
  }
  return { documento: document, almacen, seguro: location.protocol === 'https:', ahoraSegundos: Math.floor(Date.now() / 1000) };
}

/** Instantánea cruda para `useSyncExternalStore`: `''` sin decisión; texto con decisión. */
export function instantaneaConsentimiento(): string {
  const e = entornoNavegador();
  return e ? leerCrudo(e) : '';
}

export function consentimientoActual(): Consentimiento | null {
  return interpretar(instantaneaConsentimiento());
}

/** Guarda la decisión y avisa a la pestaña (y por `storage`, a las demás). Si se retira marketing, borra las cookies de Meta. */
export function guardarConsentimiento(elecciones: Elecciones): Consentimiento | null {
  const e = entornoNavegador();
  if (!e) return null;
  const previo = leer(e);
  const c = escribir(elecciones, e);
  if (previo?.marketing && !c.marketing) {
    for (const n of COOKIES_META) borrarCookie(n, document, location.hostname);
  }
  window.dispatchEvent(new Event(EVENTO_CONSENTIMIENTO));
  return c;
}

export function suscribirConsentimiento(alCambiar: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(EVENTO_CONSENTIMIENTO, alCambiar);
  window.addEventListener('storage', alCambiar);
  return () => {
    window.removeEventListener(EVENTO_CONSENTIMIENTO, alCambiar);
    window.removeEventListener('storage', alCambiar);
  };
}

/** Pide abrir la ventana de preferencias (enlace «Cookies» del pie). */
export function abrirPreferenciasCookies(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_ABRIR_COOKIES));
}
