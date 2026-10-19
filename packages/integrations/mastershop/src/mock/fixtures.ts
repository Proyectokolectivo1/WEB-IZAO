/**
 * Respuestas de la API pública de MasterShop según su colección de Postman
 * (https://documenter.getpostman.com/view/33212980/2sB3WnxNAk, consultada el 2026-10-19).
 *
 * Las formas y los textos de error marcados como documentados salen de esa colección.
 * Los marcados `[VERIFICAR]` no aparecen en ella y son supuestos del mock.
 */

export const MS_ERRORS = {
  /** Documentado (401 en todos los endpoints). */
  apiKeyRequired: { data: null, error: 'API Key requerida', success: false },
  /** Documentado (400 de esquema en POST). */
  invalidBody: 'Datos del body inválidos',
  /** Documentado (400 de parámetros en GET). */
  invalidParams: 'Datos de los parámetros inválidos',
  /** Documentado (404 en GET y PUT). */
  orderNotFound: { data: null, error: 'Orden no existe!', success: false },
  /** Documentado (500 genérico). */
  internal: { data: null, error: 'Error interno del servidor', success: false },
  /** Documentado: creación repetida. */
  duplicateOrder: {
    data: null,
    error: 'Código 409 - La orden ya existe - Error interno del servidor',
    success: false,
  },
  /** Documentado: 409 por edición concurrente en PUT. */
  concurrentEdit: {
    data: null,
    error: 'Ya hay una actualización en curso para esta orden. Intenta nuevamente en unos segundos',
    success: false,
  },
  /** `[VERIFICAR]` el texto: la documentación describe el caso pero no trae ejemplo. */
  notEditable: {
    data: null,
    error: 'La orden no se puede actualizar en su estado actual',
    success: false,
  },
  /** Documentado (422 en PUT). */
  rejected: {
    data: null,
    error: 'La plataforma rechazó la actualización. La orden no fue modificada',
    success: false,
  },
  /** Documentado (502 en PUT). */
  notConfirmed: {
    data: null,
    error:
      'La plataforma no confirmó el resultado de la actualización: puede haberse aplicado o no. No reintentes: consulta la orden con GET /api/orders?idOrder={idOrder} para ver su estado actual',
    success: false,
  },
  /** Documentado (sección de límites). */
  tooManyRequests: { error: 'Demasiadas solicitudes, intenta de nuevo más tarde' },
  /** `[VERIFICAR]` el texto de los 400 de reglas de negocio (total, moneda, documento). */
  totalMismatch: 'El total de la orden no coincide con la suma de los ítems y cargos adicionales',
  currencyNotLegal: 'La moneda no es válida para el país de la dirección',
  documentPair: 'documentType y documentNumber deben enviarse juntos',
} as const;

/** Estados en el texto del listado (`orderStatus`) y su `statusParent` observado, por id. */
export const MS_STATUS_NAMES: Readonly<Record<number, { name: string; parent: string | null }>> = {
  1: { name: 'Por Confirmar', parent: 'Por preparar' },
  2: { name: 'Pendiente', parent: 'Por preparar' },
  3: { name: 'Por Alistar', parent: 'En preparación' },
  4: { name: 'Por Recolectar', parent: 'En preparación' },
  5: { name: 'Recolectada', parent: 'En preparación' },
  6: { name: 'En tránsito', parent: 'En tránsito' },
  8: { name: 'Entregada', parent: 'Finalizadas' },
  9: { name: 'Cancelada', parent: 'Finalizadas' },
  10: { name: 'Devuelta', parent: 'Finalizadas' },
  11: { name: 'Reclamaciones', parent: 'Finalizadas' },
};

/** Ejemplo documentado de un ítem del listado (`POST /api/orders/list`). */
export const LIST_ITEM_EXAMPLE = {
  alerts: [],
  cancelReason: null,
  carrierName: 'Transportadora',
  carrierTrackingCode: '240000000001',
  clientInfo: {
    address: 'Calle 10 # 43-20',
    city: 'Medellín',
    district: 'El Poblado',
    fullName: 'Laura Gomez',
    phone: '3001234567',
    state: 'Antioquia',
  },
  confirmationStatusName: null,
  createdAt: '2026-10-19T15:00:00.000Z',
  currency: 'COP',
  externalOrderId: 'PED-0001',
  hasNovelty: false,
  idOrder: 1001,
  items: [{ name: 'Producto' }],
  lastCarrierStatusUpdate: null,
  orderStatus: 'Pendiente',
  paymentMethod: 'cod',
  roleType: null,
  shipmentDate: null,
  shippingRate: 12000,
  statusParent: 'Por preparar',
  totalOrder: 89900,
  totalProvider: 50000,
} as const;

/** Ejemplo documentado del detalle (`GET /api/orders`): solo los tres bloques del esquema. */
export const GET_ORDER_EXAMPLE = {
  carrierTrackingCode: '240000000001',
  customer: { document: '1020304050' },
  externalOrderId: 'PED-0001',
  idOrder: 1001,
  orderLogistics: {
    carrierTracking: {
      guide: '240000000001',
      orderTracking: 'https://rastreo.example.com/240000000001',
      shippingLabel: 'https://labels.example.com/240000000001.pdf',
    },
  },
  shippingAddress: {
    address: 'Calle 10 # 43-20',
    addressDetail: 'Apto 501',
    city: 'Medellín',
    company: null,
    country: 'Colombia',
    country_code: 'CO',
    district: 'El Poblado',
    first_name: 'Laura',
    full_name: 'Laura Gomez',
    last_name: 'Gomez',
    phone: '3001234567',
    state: 'Antioquia',
    zip: null,
  },
} as const;
