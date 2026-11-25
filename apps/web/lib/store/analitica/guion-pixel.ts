/**
 * Arranque del Meta Pixel en el navegador (§23.2), SOLO tras el consentimiento de marketing (opt-in estricto).
 *
 * Antes del sí no existe `window.fbq`, no se descarga `fbevents.js` y no se envía nada (ni siquiera la imagen `<noscript>`:
 * sin JavaScript no hay forma de saber si la persona aceptó). Al aceptar, `iniciarPixel` define la cola `fbq`, inicia el Pixel
 * del país y encola el `PageView` de la página actual; `cargarFbevents` baja el script de Meta (una sola vez). Todo va con
 * `trackSingle` sobre el Pixel del país: aunque hubiera dos pixeles en el mismo documento, nunca se cruzan los eventos.
 * Al retirar el consentimiento, `detenerPixel` deja de aceptar eventos; el cambio completo aplica al recargar la página.
 *
 * El id se valida (solo dígitos) antes de usarse. No hay código en línea: el script viene de `connect.facebook.net`, que la
 * CSP ya permite en `script-src`.
 */
import { esPixelId } from '@izao/meta-pixel';

export const ORIGEN_FBEVENTS = 'https://connect.facebook.net/en_US/fbevents.js';

interface ColaFbq {
  (...args: unknown[]): void;
  push?: unknown;
  loaded?: boolean;
  version?: string;
  queue?: unknown[];
  callMethod?: (...args: unknown[]) => void;
}

/** Lo que el Pixel deja en `window`. */
export interface VentanaFb {
  fbq?: ColaFbq;
  _fbq?: ColaFbq;
  /** Id del Pixel activo en esta página; vacío si no hay consentimiento. Lo lee `rastrear` (`pixel-cliente.ts`). */
  __izaoPixelId?: string;
  /** Id con el que ya se hizo `init` (si se retira y se vuelve a dar el consentimiento no se repite). */
  __izaoPixelIniciado?: string;
  __izaoFbScript?: boolean;
}

type DocumentoFb = Pick<Document, 'createElement' | 'getElementsByTagName'> & { head?: Node | null };

function crearCola(w: VentanaFb): ColaFbq {
  // Igual que el código base de Meta: la cola recibe el objeto `arguments`, que `fbevents.js` sabe procesar.
  const n = function (this: unknown) {
    // eslint-disable-next-line prefer-rest-params
    const args = arguments;
    if (n.callMethod) n.callMethod(...Array.from(args));
    else n.queue!.push(args);
  } as ColaFbq;
  if (!w._fbq) w._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  w.fbq = n;
  return n;
}

/**
 * Inicia (o reanuda) el Pixel del país y encola el `PageView` de la página actual. Idempotente por Pixel: reanudar tras
 * retirar el consentimiento no repite `init`. Lanza si el id no son dígitos.
 */
export function iniciarPixel(pixelId: string, w: VentanaFb): void {
  if (!esPixelId(pixelId)) throw new Error('Pixel ID inválido');
  // Ya activo para este Pixel (p. ej. el efecto corre dos veces en desarrollo): no se repite el `PageView`.
  if (w.__izaoPixelId === pixelId) return;
  const fbq = w.fbq ?? crearCola(w);
  // Si se había revocado, se vuelve a conceder (sin efecto si nunca se revocó).
  fbq('consent', 'grant');
  if (w.__izaoPixelIniciado !== pixelId) {
    fbq('init', pixelId);
    w.__izaoPixelIniciado = pixelId;
  }
  w.__izaoPixelId = pixelId;
  fbq('trackSingle', pixelId, 'PageView');
}

/** Descarga `fbevents.js` (una sola vez por documento). Devuelve `false` si ya estaba pedida o no hay dónde ponerla. */
export function cargarFbevents(w: VentanaFb, d: DocumentoFb): boolean {
  if (w.__izaoFbScript) return false;
  w.__izaoFbScript = true;
  const s = d.createElement('script');
  s.async = true;
  s.src = ORIGEN_FBEVENTS;
  const primero = d.getElementsByTagName('script')[0];
  if (primero?.parentNode) primero.parentNode.insertBefore(s, primero);
  else d.head?.appendChild(s);
  return true;
}

/**
 * Retira el consentimiento: Meta recibe `revoke` y el Pixel deja de aceptar eventos (`rastrear` ya no encuentra
 * `__izaoPixelId`). El script no se puede descargar de la página en caliente; el cambio completo aplica al recargar.
 */
export function detenerPixel(w: VentanaFb): void {
  try {
    w.fbq?.('consent', 'revoke');
  } catch {
    /* nada */
  }
  delete w.__izaoPixelId;
}

/**
 * Pone el Pixel de esta página de acuerdo con la decisión de marketing. `true` lo inicia (o reanuda); `false` lo detiene si
 * estaba activo y, si nunca lo estuvo, no toca nada (no existe `fbq`: no se carga ni se envía nada).
 */
export function sincronizarPixel(marketing: boolean, pixelId: string, w: VentanaFb): 'iniciado' | 'detenido' | 'nada' {
  if (marketing) {
    if (w.__izaoPixelId === pixelId) return 'nada';
    iniciarPixel(pixelId, w);
    return 'iniciado';
  }
  if (!w.__izaoPixelId) return 'nada';
  detenerPixel(w);
  return 'detenido';
}
