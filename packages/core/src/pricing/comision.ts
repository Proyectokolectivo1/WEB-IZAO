/**
 * Comisión estimada de la pasarela (§12.2, métricas): `(monto × fee_pct + fee_fixed) × (1 + fee_tax_pct)`.
 * Los porcentajes llegan como `numeric(6,3)` del panel (`payment_method_settings`) y se convierten a
 * milésimas `bigint`; un solo redondeo medio hacia arriba al final. Se guarda en `payments.fee_amount`.
 */
import { roundHalfUpDiv } from '../money';

/** `'2.65'` → 2650n (milésimas de punto porcentual). `null` si no es un porcentaje válido. */
export function parsePercentThousandths(value: unknown): bigint | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return null;
  return BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}

export interface ComisionConfig {
  fee_pct: unknown;
  fee_fixed: bigint;
  fee_tax_pct: unknown;
}

/** 100 % en milésimas de punto porcentual. */
const CIEN = 100_000n;

export function comisionPasarela(monto: bigint, cfg: ComisionConfig): bigint {
  const pct = parsePercentThousandths(cfg.fee_pct);
  const iva = parsePercentThousandths(cfg.fee_tax_pct);
  if (pct === null || iva === null) throw new RangeError('Porcentaje de comisión inválido.');
  if (typeof monto !== 'bigint' || monto < 0n) throw new RangeError('Monto inválido para la comisión.');
  if (typeof cfg.fee_fixed !== 'bigint' || cfg.fee_fixed < 0n) throw new RangeError('Comisión fija inválida.');
  const base = monto * pct + cfg.fee_fixed * CIEN; // comisión × CIEN
  return roundHalfUpDiv(base * (CIEN + iva), CIEN * CIEN);
}
