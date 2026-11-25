/**
 * Eventos del Meta Pixel desde el navegador (§23.2). Solo tras el consentimiento de marketing, `iniciarPixel`
 * (`guion-pixel.ts`) deja `window.fbq` y `window.__izaoPixelId`; sin consentimiento, o sin Pixel configurado para el país,
 * no existen y todo esto es un no-op silencioso (la tienda no cambia de comportamiento). Al retirar el consentimiento
 * `detenerPixel` borra `__izaoPixelId` y los eventos dejan de salir. Nada lanza: la analítica nunca rompe una compra.
 */
import { idContenido, idEventoCompra, monedaDePais, parametrosContenido, type EventoMeta, type LineaEvento } from '@izao/meta-pixel';
import type { LineaCarrito } from '../carrito/logica';

export interface VentanaPixel {
  fbq?: (...args: unknown[]) => void;
  __izaoPixelId?: string;
}

type Almacen = Pick<Storage, 'getItem' | 'setItem'>;
type LineaPixel = Pick<LineaCarrito, 'variantId' | 'sku' | 'cantidad' | 'precio'>;

const ventana = (): VentanaPixel | null => (typeof window === 'undefined' ? null : (window as unknown as VentanaPixel));

/** Envía un evento al Pixel de esta página. `eventId` solo cuando el servidor manda el mismo (deduplicación). */
export function rastrear(evento: EventoMeta, parametros?: Record<string, unknown>, eventId?: string, w: VentanaPixel | null = ventana()): boolean {
  try {
    if (!w?.fbq || !w.__izaoPixelId) return false;
    if (eventId) w.fbq('trackSingle', w.__izaoPixelId, evento, parametros ?? {}, { eventID: eventId });
    else w.fbq('trackSingle', w.__izaoPixelId, evento, parametros ?? {});
    return true;
  } catch {
    return false;
  }
}

/** ¿Está activo el Pixel con este id? (el `PageView` de navegación no actúa si el documento trae otro). */
export function pixelActivo(pixelId: string, w: VentanaPixel | null = ventana()): boolean {
  return Boolean(w?.fbq && w.__izaoPixelId === pixelId);
}

export function lineaDeCarrito(l: LineaPixel): LineaEvento {
  return { id: idContenido(l.sku, l.variantId), cantidad: l.cantidad, precioUnitario: BigInt(l.precio) };
}

export function eventoAgregado(l: LineaPixel & Pick<LineaCarrito, 'nombre'>, pais: string) {
  return { ...parametrosContenido([lineaDeCarrito(l)], monedaDePais(pais)), content_name: l.nombre };
}

export function eventoInicioCheckout(lineas: readonly LineaPixel[], pais: string) {
  return parametrosContenido(lineas.map(lineaDeCarrito), monedaDePais(pais));
}

export interface DatosCompra {
  numero: string;
  /** `total_customer` en unidad menor, entero en texto. */
  total: string;
  lineas: { contentId: string; cantidad: number; precio: string }[];
}

export function eventoCompra(c: DatosCompra, pais: string) {
  return {
    eventId: idEventoCompra(c.numero),
    parametros: parametrosContenido(
      c.lineas.map((l) => ({ id: l.contentId, cantidad: l.cantidad, precioUnitario: BigInt(l.precio) })),
      monedaDePais(pais),
      BigInt(c.total),
    ),
  };
}

const claveCompra = (numero: string): string => `izao:px:compra:${numero}`;

function almacenLocal(): Almacen | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Purchase del navegador, una sola vez por pedido: si ya se marcó en este navegador (recarga, vuelta atrás) no se repite.
 * Aunque el almacenamiento fallara, el `eventID` determinista hace que Meta descarte el duplicado.
 */
export function rastrearCompraUnaVez(
  c: DatosCompra,
  pais: string,
  o: { w?: VentanaPixel | null; almacen?: Almacen | null } = {},
): 'enviado' | 'repetido' | 'sin_pixel' {
  const almacen = o.almacen === undefined ? almacenLocal() : o.almacen;
  const clave = claveCompra(c.numero);
  try {
    if (almacen?.getItem(clave)) return 'repetido';
  } catch {
    /* almacenamiento bloqueado: se confía en el eventID */
  }
  const { eventId, parametros } = eventoCompra(c, pais);
  if (!rastrear('Purchase', parametros, eventId, o.w === undefined ? ventana() : o.w)) return 'sin_pixel';
  try {
    almacen?.setItem(clave, '1');
  } catch {
    /* idem */
  }
  return 'enviado';
}
