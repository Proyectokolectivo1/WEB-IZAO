/**
 * Piezas comunes del Meta Pixel (navegador) y de la API de Conversiones (servidor), §23.2. Sin dependencias de Node:
 * las usa también el navegador. Garantiza que ambos canales hablen igual (mismo `event_id`, mismo `content_id`, mismo
 * valor), que es lo que permite a Meta deduplicar.
 *
 * Dinero: la tienda guarda enteros en unidad menor (regla 1). Meta pide un número decimal en unidad mayor; esa conversión
 * (COP exponente 0, USD exponente 2) se hace aquí, solo para el evento, a partir de la representación decimal exacta.
 */
import {
  COUNTRY_CURRENCY,
  fromDbAmount,
  isCurrencyCode,
  money,
  toDecimalString,
  type CountryCode,
  type CurrencyCode,
} from '@izao/core/money';

/** Pixel ID de Meta: solo dígitos (mismo criterio que el formulario del panel). Se valida antes de escribirlo en un script. */
const PIXEL_ID = /^\d{5,20}$/;

export function esPixelId(v: unknown): v is string {
  return typeof v === 'string' && PIXEL_ID.test(v);
}

export type EventoMeta = 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase';

/** Moneda ISO del país de la tienda (`'co'`, `'CO'`…). */
export function monedaDePais(pais: string): CurrencyCode {
  const codigo = pais.toUpperCase() as CountryCode;
  const moneda = COUNTRY_CURRENCY[codigo];
  if (!moneda) throw new Error(`País sin moneda: ${pais}`);
  return moneda;
}

/**
 * Monto en unidad menor → número decimal en unidad mayor para el evento (`90000` COP → `90000`; `9982` USD → `99.82`).
 * Parte del texto decimal exacto, así que no acumula error de coma flotante.
 */
export function valorEvento(monto: bigint | number | string, moneda: string): number {
  if (!isCurrencyCode(moneda)) throw new Error(`Moneda no soportada: ${moneda}`);
  return Number(toDecimalString(money(fromDbAmount(monto), moneda)));
}

/** `event_id` del Purchase: el mismo en el navegador y en el servidor. Determinista por pedido (número `IZ-CO-000123`). */
export function idEventoCompra(numeroPedido: string): string {
  return `purchase_${numeroPedido}`;
}

/** Id de producto para Meta: el SKU de la variante; si faltara, el id de la variante. Igual en tienda, pedido y servidor. */
export function idContenido(sku: string | null | undefined, varianteId: string): string {
  const s = typeof sku === 'string' ? sku.trim() : '';
  return s || varianteId;
}

export interface LineaEvento {
  /** Resultado de `idContenido`. */
  id: string;
  cantidad: number;
  /** Precio unitario en unidad menor. */
  precioUnitario: bigint | number | string;
}

export interface ParametrosContenido {
  content_ids: string[];
  content_type: 'product';
  contents: { id: string; quantity: number; item_price: number }[];
  num_items: number;
  value: number;
  currency: CurrencyCode;
  [clave: string]: unknown;
}

/**
 * Parámetros de contenido de un evento a partir de las líneas. `value` = suma de precio × cantidad, o `valorTotal`
 * (unidad menor) cuando el evento debe llevar el total del pedido (Purchase: incluye recargo y descuentos).
 */
export function parametrosContenido(lineas: readonly LineaEvento[], moneda: CurrencyCode, valorTotal?: bigint | number | string): ParametrosContenido {
  let suma = 0n;
  for (const l of lineas) suma += fromDbAmount(l.precioUnitario) * BigInt(l.cantidad);
  return {
    content_ids: [...new Set(lineas.map((l) => l.id))],
    content_type: 'product',
    contents: lineas.map((l) => ({ id: l.id, quantity: l.cantidad, item_price: valorEvento(l.precioUnitario, moneda) })),
    num_items: lineas.reduce((a, l) => a + l.cantidad, 0),
    value: valorEvento(valorTotal ?? suma, moneda),
    currency: moneda,
  };
}
