/**
 * Estados de transacción de Wompi (docs.wompi.co, D-024) → `payments.status`.
 * PENDING no es final; APPROVED, DECLINED, VOIDED (anulada, solo tarjeta) y ERROR sí.
 */
import type { PaymentStatus } from '@izao/core/contracts';

export const ESTADOS_WOMPI = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'] as const;
export type EstadoWompi = (typeof ESTADOS_WOMPI)[number];

const MAPA: Record<EstadoWompi, PaymentStatus> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  VOIDED: 'voided',
  ERROR: 'error',
};

export function esEstadoWompi(v: unknown): v is EstadoWompi {
  return typeof v === 'string' && (ESTADOS_WOMPI as readonly string[]).includes(v);
}

export function estadoDePago(s: EstadoWompi): PaymentStatus {
  return MAPA[s];
}
