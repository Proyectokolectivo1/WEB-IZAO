/** Formato de números y fechas del panel: moneda del país y hora de Bogotá (§21.1, skill del panel). */
import { formatMoney, money, type CurrencyCode } from '@izao/core/money';

/** `bigint` en unidad menor → `$ 90.000` (COP) o `$99,82` (USD). */
export function dineroBig(monto: bigint, moneda: CurrencyCode): string {
  return formatMoney(money(monto, moneda));
}

/** Puntos básicos (1250n = 12,50 %) → `12,5 %`; `null` → `—`. */
export function porcentajeBp(bp: bigint | null): string {
  if (bp === null) return '—';
  const signo = bp < 0n ? '-' : '';
  const abs = bp < 0n ? -bp : bp;
  const entero = abs / 100n;
  const dec = abs % 100n;
  const texto = dec === 0n ? `${entero}` : `${entero},${String(dec).padStart(2, '0').replace(/0$/, '')}`;
  return `${signo}${texto} %`;
}

const FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function fechaHoraBogota(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : FECHA_HORA.format(d);
}
