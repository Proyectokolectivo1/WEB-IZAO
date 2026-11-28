/**
 * Impresión manual de la guía por flete alto (D-062). Si el flete de la transportadora supera
 * `country_settings.auto_print_max_shipping_rate`, el worker no crea el trabajo automático y deja el evento
 * `transportadora` `impresion_manual_requerida` (una vez por pedido) y la alerta del mismo nombre. El panel avisa
 * hasta que haya una impresión pedida desde el panel. Funciones puras (sin I/O).
 */
import { formatMoney, money, type CurrencyCode } from '@izao/core/money';

export const MOTIVO_IMPRESION_MANUAL = 'impresion_manual_requerida';

export type ImpresionManual = { flete: number | null; umbral: number | null };

function entero(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Retención del pedido según sus eventos (con payload), o `null` si se imprime solo. */
export function impresionManualDeEventos(eventos: readonly { type: string; payload?: unknown }[]): ImpresionManual | null {
  const ev =
    eventos.find((e) => e.type === 'transportadora' && (e.payload as { accion?: unknown } | null)?.accion === MOTIVO_IMPRESION_MANUAL) ??
    eventos.find((e) => e.type === 'alerta' && (e.payload as { motivo?: unknown } | null)?.motivo === MOTIVO_IMPRESION_MANUAL);
  if (!ev) return null;
  const p = (ev.payload ?? {}) as { flete?: unknown; umbral?: unknown };
  return { flete: entero(p.flete), umbral: entero(p.umbral) };
}

/** `true` si ya se pidió imprimir desde el panel (en cola, imprimiendo o impresa): el aviso se apaga. */
export function impresionManualAtendida(impresiones: readonly { type: string; status: string; requested_by: string }[]): boolean {
  return impresiones.some((i) => i.type === 'label' && i.requested_by.startsWith('admin:') && ['queued', 'claimed', 'printed'].includes(i.status));
}

function monto(v: number | null, moneda: string): string {
  return v === null ? '—' : formatMoney(money(BigInt(v), moneda as CurrencyCode));
}

/** Texto del aviso del detalle del pedido. */
export function textoImpresionManual(r: ImpresionManual, moneda: string): string {
  return `Flete ${monto(r.flete, moneda)} supera el umbral ${monto(r.umbral, moneda)}: llama al cliente y luego imprime la guía.`;
}
