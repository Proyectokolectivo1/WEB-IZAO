/**
 * Estados del callback de Addi (documentación oficial, `Status`) → `payments.status`.
 * - APPROVED: crédito aprobado por el 100 % del valor.
 * - PENDING: en validación (no final).
 * - REJECTED: Addi no aprobó al cliente → `declined`.
 * - DECLINED: el cliente desistió → `declined` (el original queda en `raw_last_event`).
 * - ABANDONED: superó el tiempo máximo en Addi → `expired`.
 * - INTERNAL_ERROR: error de Addi; el cliente debe elegir otro método → `error`.
 * Todo lo distinto de APPROVED llega con `approvedAmount = 0`.
 */
import type { PaymentStatus } from '@izao/core/contracts';

export const ESTADOS_ADDI = ['APPROVED', 'PENDING', 'REJECTED', 'ABANDONED', 'DECLINED', 'INTERNAL_ERROR'] as const;
export type EstadoAddi = (typeof ESTADOS_ADDI)[number];

const MAPA: Record<EstadoAddi, PaymentStatus> = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'declined',
  DECLINED: 'declined',
  ABANDONED: 'expired',
  INTERNAL_ERROR: 'error',
};

export function estadoPagoAddi(s: EstadoAddi): PaymentStatus {
  return MAPA[s];
}
