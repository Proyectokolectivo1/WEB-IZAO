/**
 * Nombres compartidos entre el webhook (productor, `apps/web`) y el worker (consumidor) para BullMQ.
 * BullMQ no admite `:` en ids personalizados; el id del job deduplica entregas repetidas del mismo evento.
 */
export const COLA_PAGOS = 'pagos';
export const JOB_WOMPI_TRANSACCION = 'wompi.transaccion';

export interface DatosJobWompi {
  event_id: string;
  transaction_id: string;
}

export function jobIdWompi(eventId: string): string {
  return `wompi.${eventId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
