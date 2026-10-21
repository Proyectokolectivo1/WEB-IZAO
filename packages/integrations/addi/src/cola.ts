/**
 * Contrato BullMQ entre el webhook de Addi (`apps/web`) y el worker. Misma cola `pagos` que Wompi.
 * BullMQ no admite `:` en ids personalizados; el id deduplica reentregas del mismo callback.
 */
import type { CallbackAddi } from './callback';

export const JOB_ADDI_CALLBACK = 'addi.callback';

export interface DatosJobAddi {
  event_id: string;
  callback: CallbackAddi;
}

export function jobIdAddi(eventId: string): string {
  return `addi.${eventId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
