/**
 * Nombres compartidos entre el webhook (productor, `apps/web`) y el worker (consumidor) para BullMQ.
 * BullMQ no admite `:` en ids personalizados; el id del job deduplica entregas repetidas del mismo evento.
 */
export const COLA_PAGOS = 'pagos';
export const JOB_WOMPI_TRANSACCION = 'wompi.transaccion';

export interface DatosJobWompi {
  /** Id del evento en `webhook_events`; en la conciliación, `conciliacion.{transaction_id}.{STATUS}` (sin fila). */
  event_id: string;
  transaction_id: string;
  /** `conciliacion`: lo encontró el job de conciliación contra la API (respaldo del webhook, D-059). */
  origen?: 'webhook' | 'conciliacion';
}

export function jobIdWompi(eventId: string): string {
  return `wompi.${eventId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
