/**
 * Formato de las cifras del dashboard. Puro; los montos siguen siendo `bigint` hasta el último paso y solo el
 * ancho de las barras de las gráficas usa números (nunca para dinero).
 */
import type { Bp } from '@izao/core/metrics';
import { porcentajeBp } from '../formato';

/** ROAS en puntos básicos (112000n = 11,2×) → `11,2×`; `null` → `—`. */
export function formatoRoas(bp: Bp | null): string {
  if (bp === null) return '—';
  const centesimas = (bp + 50n) / 100n; // dos decimales, medio hacia arriba
  const entero = centesimas / 100n;
  const dec = centesimas % 100n;
  const texto = dec === 0n ? `${entero}` : `${entero},${String(dec).padStart(2, '0').replace(/0$/, '')}`;
  return `${texto}×`;
}

/** Variación contra el periodo anterior: `+12,5 %`, `-3 %`; `null` (sin base) → `Sin periodo anterior`. */
export function textoVariacion(bp: Bp | null): string {
  if (bp === null) return 'Sin base de comparación';
  if (bp === 0n) return 'Sin cambio';
  return `${bp > 0n ? '+' : ''}${porcentajeBp(bp)}`;
}

/** `sube` / `baja` / `igual` para el icono y la lectura de pantalla. */
export function sentidoVariacion(bp: Bp | null): 'sube' | 'baja' | 'igual' | 'sin_base' {
  if (bp === null) return 'sin_base';
  return bp > 0n ? 'sube' : bp < 0n ? 'baja' : 'igual';
}

/** Ancho 0–100 de una barra respecto al máximo, con un mínimo visible cuando hay valor. */
export function anchoRelativo(valor: bigint, maximo: bigint): number {
  if (maximo <= 0n || valor <= 0n) return 0;
  const p = Number((valor * 10_000n) / maximo) / 100;
  return Math.max(p, 1);
}
