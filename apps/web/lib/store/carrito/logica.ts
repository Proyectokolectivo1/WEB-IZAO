/**
 * Lógica pura del carrito (§7.7): serialización a `localStorage` y alta/baja/cantidades. El subtotal de vista previa
 * (`calcularPrecios`) vive en `vista.ts` para que el motor de precios no viaje en todas las páginas. El servidor recalcula siempre precios, stock y descuentos;
 * lo de aquí solo se muestra. Los precios viajan como texto entero (unidad menor) para no usar `Number` con dinero.
 */
import type { MediaRef } from '../types';

export interface LineaCarrito {
  variantId: string;
  productId: string;
  slug: string;
  nombre: string;
  /** Presentación de la variante (p. ej. «100 ml»). */
  presentacion: string | null;
  cantidad: number;
  /** Unidad menor, entero en texto. */
  precio: string;
  tachado: string | null;
  /** Existencias al agregar; tope de cantidad en la interfaz. */
  max: number;
  imagen: MediaRef | null;
}

export const VERSION_CARRITO = 1;
const ENTERO = /^\d{1,15}$/;

export function claveCarrito(pais: string): string {
  return `izao:carrito:${pais}`;
}

/** Ruta del checkout del país: destino de «Comprar ahora» (el servidor recalcula todo allí). */
export function rutaCheckout(pais: string): string {
  return `/${pais}/checkout`;
}

export function serializar(lineas: readonly LineaCarrito[]): string {
  return JSON.stringify({ v: VERSION_CARRITO, lineas });
}

/** Lee lo guardado descartando cualquier cosa que no tenga la forma esperada (nunca lanza). */
export function leer(texto: string | null): LineaCarrito[] {
  if (!texto) return [];
  try {
    const obj: unknown = JSON.parse(texto);
    if (!obj || typeof obj !== 'object' || (obj as { v?: unknown }).v !== VERSION_CARRITO) return [];
    const crudas = (obj as { lineas?: unknown }).lineas;
    if (!Array.isArray(crudas)) return [];
    const vistas = new Set<string>();
    const out: LineaCarrito[] = [];
    for (const c of crudas.slice(0, 50)) {
      const l = c as Partial<LineaCarrito> | null;
      if (!l || typeof l.variantId !== 'string' || typeof l.productId !== 'string' || vistas.has(l.variantId)) continue;
      if (typeof l.slug !== 'string' || typeof l.nombre !== 'string') continue;
      if (typeof l.precio !== 'string' || !ENTERO.test(l.precio)) continue;
      const tachado = typeof l.tachado === 'string' && ENTERO.test(l.tachado) ? l.tachado : null;
      const max = Number.isInteger(l.max) && (l.max as number) > 0 ? (l.max as number) : 1;
      const cantidad = Math.min(Math.max(Number.isInteger(l.cantidad) ? (l.cantidad as number) : 1, 1), max);
      vistas.add(l.variantId);
      out.push({
        variantId: l.variantId,
        productId: l.productId,
        slug: l.slug,
        nombre: l.nombre,
        presentacion: typeof l.presentacion === 'string' ? l.presentacion : null,
        cantidad,
        precio: l.precio,
        tachado,
        max,
        imagen: l.imagen && typeof l.imagen === 'object' ? l.imagen : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Suma `cantidad` a la línea si ya existe (respetando el tope) o la crea. */
export function agregarLinea(lineas: readonly LineaCarrito[], nueva: LineaCarrito): LineaCarrito[] {
  const i = lineas.findIndex((l) => l.variantId === nueva.variantId);
  if (i === -1) return [...lineas, { ...nueva, cantidad: Math.min(Math.max(nueva.cantidad, 1), nueva.max) }];
  return lineas.map((l, k) =>
    k === i
      ? { ...l, precio: nueva.precio, tachado: nueva.tachado, max: nueva.max, cantidad: Math.min(l.cantidad + nueva.cantidad, nueva.max) }
      : l,
  );
}

export function cambiarCantidad(lineas: readonly LineaCarrito[], variantId: string, cantidad: number): LineaCarrito[] {
  if (cantidad <= 0) return lineas.filter((l) => l.variantId !== variantId);
  return lineas.map((l) => (l.variantId === variantId ? { ...l, cantidad: Math.min(Math.floor(cantidad), l.max) } : l));
}

export function quitarLinea(lineas: readonly LineaCarrito[], variantId: string): LineaCarrito[] {
  return lineas.filter((l) => l.variantId !== variantId);
}

export function contarUnidades(lineas: readonly LineaCarrito[]): number {
  return lineas.reduce((a, l) => a + l.cantidad, 0);
}
