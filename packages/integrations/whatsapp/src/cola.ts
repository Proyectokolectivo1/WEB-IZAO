/**
 * Nombres BullMQ compartidos entre productores (`apps/web`) y el worker para contra entrega y WhatsApp (D-025).
 * BullMQ no admite `:` en ids personalizados: se usan puntos. Los ids fijos deduplican.
 */
export const COLA_COD = 'contraentrega';
export const JOB_COD_INICIAR = 'cod.iniciar';
export const JOB_COD_RECORDATORIO = 'cod.recordatorio';
export const JOB_COD_ABANDONO = 'cod.abandono';
/** "Reenviar cobro" del panel (admin y operador). */
export const JOB_COD_REENVIAR = 'cod.reenviar';

export const COLA_WHATSAPP = 'whatsapp';
export const JOB_WA_EVENTO = 'whatsapp.evento';

export interface DatosJobCodIniciar {
  order_id: string;
}
export interface DatosJobCodRecordatorio {
  order_id: string;
  /** 1, 2, 3…: índice en `cod_reminder_offsets_minutes`. */
  n: number;
}
export interface DatosJobCodAbandono {
  order_id: string;
}
export interface DatosJobCodReenviar {
  order_id: string;
  /** ISO 8601 UTC de la solicitud: es el `scheduled_for` del reenvío (repetir el job no duplica el mensaje). */
  solicitado_en: string;
}
export interface DatosJobWaEvento {
  /** `webhook_events.event_id` (provider `whatsapp`). */
  event_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idPedido(orderId: string): string {
  if (!UUID.test(orderId)) throw new RangeError('order_id debe ser un UUID.');
  return orderId.toLowerCase();
}

export const jobIdCodIniciar = (orderId: string): string => `cod.iniciar.${idPedido(orderId)}`;
export const jobIdCodRecordatorio = (orderId: string, n: number): string => `cod.recordatorio.${idPedido(orderId)}.${n}`;
export const jobIdCodAbandono = (orderId: string): string => `cod.abandono.${idPedido(orderId)}`;
export const jobIdCodReenviar = (orderId: string, solicitadoEn: Date): string => `cod.reenviar.${idPedido(orderId)}.${solicitadoEn.getTime()}`;
export const jobIdWaEvento = (eventId: string): string => `wa.${eventId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200)}`;
