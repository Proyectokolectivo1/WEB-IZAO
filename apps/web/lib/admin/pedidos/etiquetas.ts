/** Textos de estados de pedido y de mensajes para el panel (sin dependencias de servidor). */

export const ETIQUETA_ESTADO_PEDIDO: Record<string, string> = {
  pendiente_pago: 'Pendiente de pago',
  pago_rechazado: 'Pago rechazado',
  expirado: 'Expirado',
  esperando_abono: 'Esperando abono',
  abandonado: 'Abandonado',
  pendiente_manual: 'Pendiente manual',
  pagado: 'Pagado',
  abono_pagado: 'Abono pagado',
  error_transportadora: 'Error de transportadora',
  enviado_transportadora: 'Enviado a transportadora',
  en_preparacion: 'En preparación',
  en_transito: 'En tránsito',
  entregado: 'Entregado',
  devuelto: 'Devuelto',
  cancelado: 'Cancelado',
  reclamacion: 'Reclamación',
  requiere_reembolso: 'Requiere reembolso',
};

export const ETIQUETA_METODO_PAGO: Record<string, string> = {
  wompi: 'Pago completo (Wompi)',
  addi: 'Addi',
  sistecredito: 'Sistecrédito',
  cod: 'Contra entrega',
  manual: 'Manual',
};

export const ETIQUETA_MENSAJE: Record<string, string> = {
  queued: 'En cola',
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'Falló',
};

export const ETIQUETA_EVENTO: Record<string, string> = {
  status_changed: 'Cambio de estado',
  cobro_reenvio_solicitado: 'Reenvío de cobro solicitado',
};
