import { COUNTRY_CURRENCY, currencyForCountry, formatMoney, money, type CountryCode, type CurrencyCode } from '@izao/core/money';
import type { CodigoPais } from './types';

export const PAISES: readonly CodigoPais[] = ['co', 'ec'];
export const PAIS_POR_DEFECTO: CodigoPais = 'co';

export function esPais(v: string | undefined | null): v is CodigoPais {
  return v === 'co' || v === 'ec';
}

export function aCodigoCore(p: CodigoPais): CountryCode {
  return p.toUpperCase() as CountryCode;
}

export function monedaDe(p: CodigoPais): CurrencyCode {
  return currencyForCountry(aCodigoCore(p));
}

/** Etiqueta `hreflang` (§5.1). */
export function hreflangDe(p: CodigoPais): string {
  return p === 'co' ? 'es-CO' : 'es-EC';
}

/**
 * Formato de precio del país. Recibe el entero en unidad menor tal como sale del RPC (o un `bigint`).
 * Nunca se opera con `Number`: solo se convierte para mostrar.
 */
export function formatearPrecio(monto: number | bigint | string, pais: CodigoPais): string {
  const valor = typeof monto === 'bigint' ? monto : typeof monto === 'string' ? BigInt(monto) : BigInt(Math.round(monto));
  return formatMoney(money(valor, COUNTRY_CURRENCY[aCodigoCore(pais)]));
}

/** Convierte lo que escribe una persona (unidad mayor) a unidad menor, sin pasar por floats. */
export function aUnidadMenor(texto: string, pais: CodigoPais): number | null {
  const limpio = texto.replace(/[^\d,.]/g, '');
  if (!limpio) return null;
  const exp = monedaDe(pais) === 'USD' ? 2 : 0;
  const sep = limpio.lastIndexOf(',') > limpio.lastIndexOf('.') ? ',' : '.';
  const [entero = '', frac = ''] = exp === 0 ? [limpio.replace(/[.,]/g, ''), ''] : limpio.split(sep);
  const parteEntera = entero.replace(/[.,]/g, '');
  if (!/^\d+$/.test(parteEntera)) return null;
  const n = BigInt(parteEntera) * 10n ** BigInt(exp) + BigInt((frac + '00').slice(0, exp) || '0');
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}

/** Monto en unidad menor → texto editable en unidad mayor (para los campos del filtro de precio). */
export function aTextoEditable(menor: number, pais: CodigoPais): string {
  if (monedaDe(pais) === 'COP') return String(menor);
  const s = String(menor).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Granularidad del control de rango de precio, en unidad menor: COP de a 1.000 pesos, USD de a 1 dólar. */
export function pasoPrecio(pais: CodigoPais): number {
  return monedaDe(pais) === 'COP' ? 1000 : 100;
}
