/**
 * Presupuesto mensual del chat en micro-USD (§20.4). Código puro. Todo valor configurable (presupuesto, umbral de
 * degradación, modelos) llega de `chat_settings`; aquí solo está la aritmética.
 */

export type NivelPresupuesto = 'normal' | 'degradado' | 'agotado';

/** `degradarPct` en 1–100. Presupuesto 0 = sin crédito: el chat queda en modo asesor. */
export function nivelPresupuesto(p: { gastado: bigint; presupuesto: bigint; degradarPct: number }): NivelPresupuesto {
  if (p.presupuesto <= 0n || p.gastado >= p.presupuesto) return 'agotado';
  // gastado / presupuesto >= pct / 100, sin decimales.
  return p.gastado * 100n >= p.presupuesto * BigInt(p.degradarPct) ? 'degradado' : 'normal';
}

/** Modelo a usar según el nivel: respaldo al degradar (o el principal si no hay respaldo); `null` si se agotó. */
export function elegirModelo(nivel: NivelPresupuesto, primario: string | null, respaldo: string | null): string | null {
  if (nivel === 'agotado') return null;
  if (nivel === 'degradado') return respaldo?.trim() || primario?.trim() || null;
  return primario?.trim() || null;
}

export interface PreciosModelo {
  /** micro-USD por millón de tokens de entrada / salida. */
  entradaMicrosPorMtok: bigint;
  salidaMicrosPorMtok: bigint;
}

/** Estimación por tokens cuando el proveedor no informa el costo; redondea hacia arriba (nunca subestima). */
export function estimarCostoMicros(tokensIn: number, tokensOut: number, precios: PreciosModelo): bigint {
  const mega = 1_000_000n;
  const total = BigInt(Math.max(0, tokensIn)) * precios.entradaMicrosPorMtok + BigInt(Math.max(0, tokensOut)) * precios.salidaMicrosPorMtok;
  return (total + mega - 1n) / mega;
}

/** Tabla de precios de respaldo: conservadora (USD 1 / USD 4 por Mtok). Se puede ajustar por entorno sin tocar código. */
export function preciosPorDefecto(env: Record<string, string | undefined> = process.env): PreciosModelo {
  const leer = (v: string | undefined, d: bigint) => (v && /^\d{1,12}$/.test(v) ? BigInt(v) : d);
  return {
    entradaMicrosPorMtok: leer(env.CHAT_PRICE_IN_MICROS_PER_MTOK, 1_000_000n),
    salidaMicrosPorMtok: leer(env.CHAT_PRICE_OUT_MICROS_PER_MTOK, 4_000_000n),
  };
}

/** Primer día del mes (`YYYY-MM-01`) en hora de Colombia, clave de `chat_usage_monthly`. */
export function mesDeUso(ahora: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).formatToParts(ahora);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-01`;
}
