/**
 * Servidor simulado de MasterShop con las trampas documentadas (§14, §31.1):
 *
 * - `POST /api/orders/list` sin filtros devuelve solo los últimos 7 días.
 * - `limit` > 50 se recorta en silencio a 50.
 * - Crear un `id_order` repetido responde `500` "Código 409 - La orden ya existe".
 * - `externalOrderId` con guion bajo no se puede consultar (`400`).
 * - `total` debe ser exactamente Σ price × quantity + Σ additional_charge.value.
 * - Todas las claves del pedido son obligatorias aunque admitan `null`.
 * - `documentType`/`documentNumber` los dos o ninguno; moneda legal en el país.
 * - `PUT` solo 1→2, 1→9, 2→9; `409` por edición concurrente; `502` que puede haberse
 *   aplicado o no; `422` de rechazo.
 * - `RateLimit-*` en cada respuesta y `429` al agotar la ventana.
 *
 * Se usa como `fetch` inyectable (`mock.fetch`), sin red.
 */
import type { Clock } from '../clock';
import { GET_ORDER_EXAMPLE, MS_ERRORS, MS_STATUS_NAMES } from './fixtures';

export interface MockOrder {
  idOrder: number;
  externalOrderId: string;
  statusId: number;
  createdAt: Date;
  /** Cuerpo de creación tal como llegó (texto exacto). */
  rawBody: string;
  body: Record<string, unknown>;
  paymentMethod: 'cod' | 'pia';
  totalOrder: number;
  carrierName: string | null;
  carrierTrackingCode: string | null;
  guide: string | null;
  orderTracking: string | null;
  shippingLabel: string | null;
  hasNovelty: boolean;
  alerts: { idAlert: number; name: string; type: string }[];
  shippingRate: number | null;
  totalProvider: number | null;
}

export interface MockRequestLog {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string | null;
  at: number;
}

export interface InjectedResponse {
  status: number;
  body: unknown;
  /** Solo para PUT 502: si el cambio sí se aplicó aunque la respuesta falle. */
  apply?: boolean;
  headers?: Record<string, string>;
}

type Route = 'create' | 'get' | 'list' | 'update' | 'products';

export interface MasterShopMockOptions {
  apiKey: string;
  clock: Clock;
  /** Solicitudes por ventana; sin límite si se omite. */
  rateLimit?: { limit: number; windowSeconds: number };
  /** `[VERIFICAR]`: si MasterShop acepta `additional_charge` negativo (modo A). */
  acceptNegativeCharges?: boolean;
  firstOrderId?: number;
  /** Modo simulado del worker: al confirmar (1→2) adjunta guía y etiqueta al instante. */
  autoLabelOnConfirm?: boolean;
}

/** Host de las etiquetas simuladas; `mock.fetch` sirve ahí un PDF mínimo sin pedir la llave. */
export const MOCK_LABEL_HOST = 'labels.example.com';

/** PDF mínimo válido (cabecera `%PDF-`) para las etiquetas simuladas. */
export function mockLabelPdf(guide: string): Uint8Array {
  const text = `%PDF-1.4\n% Etiqueta simulada ${guide}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

const ADDRESS_KEYS = [
  'zip',
  'country',
  'city',
  'address1',
  'address2',
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'company',
  'state',
  'district',
];
const CUSTOMER_KEYS = [
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'email',
  'documentType',
  'documentNumber',
  'tags',
];
const ITEM_KEYS = ['id_product', 'id_variant', 'quantity', 'sku', 'name', 'weight', 'price'];
const TRANSACTION_KEYS = ['total', 'currency', 'payment_method', 'payment_gateway'];
const TOP_KEYS = [
  'id_order',
  'shipping_address',
  'billing_address',
  'order_transaction',
  'customer',
  'order_items',
  'additional_charge',
  'notes',
  'tags',
];
const PUT_KEYS = new Set([
  'billingAddress',
  'shippingAddress',
  'idStatus',
  'notes',
  'paymentMethod',
  'tags',
]);
const LIST_FILTER_KEYS = [
  'orderStatusParent',
  'orderStatus',
  'startDate',
  'finalDate',
  'carrier',
  'roleType',
  'paymentMethod',
  'clientName',
  'email',
  'phone',
  'idOrder',
  'productName',
  'carrierTrackingCode',
  'externalOrderId',
];
const DOC_TYPES = new Set(['CC', 'NIT', 'CE', 'DIE', 'NITEXT', 'PAS', 'RC', 'TE', 'TI']);
const LEGAL_CURRENCY: Record<string, string> = { CO: 'COP' };
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type IssuePath = string | (string | number)[];

/** Claves faltantes con la forma de la colección: `{ message: "Required", path: [...] }`. */
function missingKeys(obj: unknown, keys: readonly string[], path: (string | number)[]) {
  if (!isObject(obj)) return [{ path, message: 'Required' }];
  return keys
    .filter((k) => !Object.prototype.hasOwnProperty.call(obj, k))
    .map((k) => ({ path: [...path, k], message: 'Required' }));
}

export class MasterShopMock {
  readonly orders = new Map<number, MockOrder>();
  readonly requests: MockRequestLog[] = [];
  private readonly options: MasterShopMockOptions;
  private nextId: number;
  private readonly injected = new Map<Route, InjectedResponse[]>();
  private windowStart: number;
  private windowCount = 0;

  constructor(options: MasterShopMockOptions) {
    this.options = options;
    this.nextId = options.firstOrderId ?? 1001;
    this.windowStart = options.clock.now();
  }

  /** `fetch` compatible para inyectar en el cliente. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    return this.handle(request);
  };

  /** Encola una respuesta forzada para la próxima solicitud de esa ruta. */
  inject(route: Route, response: InjectedResponse): void {
    const queue = this.injected.get(route) ?? [];
    queue.push(response);
    this.injected.set(route, queue);
  }

  /** Crea un pedido directamente (sin pasar por la API), p. ej. para probar el listado. */
  seed(partial: Partial<MockOrder> & { externalOrderId: string; createdAt: Date }): MockOrder {
    const order: MockOrder = {
      idOrder: this.nextId++,
      statusId: 1,
      rawBody: '{}',
      body: {},
      paymentMethod: 'cod',
      totalOrder: 80000,
      carrierName: null,
      carrierTrackingCode: null,
      guide: null,
      orderTracking: null,
      shippingLabel: null,
      hasNovelty: false,
      alerts: [],
      shippingRate: null,
      totalProvider: null,
      ...partial,
    };
    this.orders.set(order.idOrder, order);
    return order;
  }

  findByExternalId(externalOrderId: string): MockOrder | undefined {
    for (const o of this.orders.values()) if (o.externalOrderId === externalOrderId) return o;
    return undefined;
  }

  /** Simula el avance del pedido en MasterShop. */
  setStatus(idOrder: number, statusId: number): void {
    const o = this.orders.get(idOrder);
    if (!o) throw new Error(`Pedido simulado ${idOrder} no existe`);
    o.statusId = statusId;
  }

  /** Simula que la transportadora generó la guía. */
  attachLabel(idOrder: number, guide: string): void {
    const o = this.orders.get(idOrder);
    if (!o) throw new Error(`Pedido simulado ${idOrder} no existe`);
    o.guide = guide;
    o.carrierTrackingCode = guide;
    o.carrierName = 'Transportadora';
    o.orderTracking = `https://rastreo.example.com/${guide}`;
    o.shippingLabel = `https://${MOCK_LABEL_HOST}/${guide}.pdf`;
  }

  countRequests(method: string, pathPrefix: string): number {
    return this.requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix)).length;
  }

  // -------------------------------------------------------------------------

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = this.options.clock.now();
    if (url.hostname === MOCK_LABEL_HOST && request.method === 'GET') {
      const guide = decodeURIComponent(url.pathname.replace(/^\/|\.pdf$/g, ''));
      const known = [...this.orders.values()].some((o) => o.guide === guide);
      if (!known) return new Response('No encontrado', { status: 404 });
      return new Response(mockLabelPdf(guide), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    const body = request.method === 'GET' ? null : await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    this.requests.push({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
      at: now,
    });

    const rl = this.rateLimit(now);
    if (rl.exceeded) return this.json(429, MS_ERRORS.tooManyRequests, rl.headers);

    if (request.headers.get('ms-api-key') !== this.options.apiKey) {
      return this.json(401, MS_ERRORS.apiKeyRequired, rl.headers);
    }

    const path = url.pathname;
    let route: Route | null = null;
    if (path === '/api/orders' && request.method === 'POST') route = 'create';
    else if (path === '/api/orders' && request.method === 'GET') route = 'get';
    else if (path === '/api/orders/list' && request.method === 'POST') route = 'list';
    else if (/^\/api\/orders\/[^/]+$/.test(path) && request.method === 'PUT') route = 'update';
    else if (path === '/api/products' && request.method === 'GET') route = 'products';
    if (route === null) return this.json(404, { error: 'Ruta no encontrada' }, rl.headers);

    const forced = this.injected.get(route)?.shift();
    if (forced && !(route === 'update' && forced.apply)) {
      return this.json(forced.status, forced.body, { ...rl.headers, ...forced.headers });
    }

    let parsed: unknown = null;
    if (body !== null && body !== '') {
      try {
        parsed = JSON.parse(body);
      } catch {
        return this.json(
          400,
          { data: null, error: MS_ERRORS.invalidBody, success: false },
          rl.headers,
        );
      }
    }

    let response: Response;
    switch (route) {
      case 'create':
        response = this.create(parsed, body ?? '', now, rl.headers);
        break;
      case 'get':
        response = this.get(url.searchParams, rl.headers);
        break;
      case 'list':
        response = this.list(url.searchParams, parsed, now, rl.headers);
        break;
      case 'update':
        response = this.update(path.split('/').pop() ?? '', parsed, rl.headers);
        break;
      case 'products':
        response = this.json(200, { results: [], resultsCount: 0 }, rl.headers);
        break;
    }
    // PUT 502 que sí se aplicó: el cambio ocurrió pero la respuesta no lo confirma.
    if (forced && route === 'update' && forced.apply) {
      return this.json(forced.status, forced.body, { ...rl.headers, ...forced.headers });
    }
    return response;
  }

  private rateLimit(now: number): { exceeded: boolean; headers: Record<string, string> } {
    const cfg = this.options.rateLimit;
    if (!cfg) return { exceeded: false, headers: {} };
    const windowMs = cfg.windowSeconds * 1000;
    if (now - this.windowStart >= windowMs) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount++;
    const resetSeconds = Math.ceil((this.windowStart + windowMs - now) / 1000);
    const headers = {
      'RateLimit-Limit': String(cfg.limit),
      'RateLimit-Remaining': String(Math.max(0, cfg.limit - this.windowCount)),
      'RateLimit-Reset': String(resetSeconds),
    };
    return { exceeded: this.windowCount > cfg.limit, headers };
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  private badRequest(
    error: string,
    data: { path: IssuePath; message: string }[] | null,
    headers: Record<string, string>,
  ): Response {
    return this.json(400, { data, error, success: false }, headers);
  }

  private create(
    parsed: unknown,
    raw: string,
    now: number,
    headers: Record<string, string>,
  ): Response {
    const missing = [
      ...missingKeys(parsed, TOP_KEYS, []),
      ...(isObject(parsed)
        ? [
            ...missingKeys(parsed.shipping_address, ADDRESS_KEYS, ['shipping_address']),
            ...missingKeys(parsed.billing_address, ADDRESS_KEYS, ['billing_address']),
            ...missingKeys(parsed.customer, CUSTOMER_KEYS, ['customer']),
            ...missingKeys(parsed.order_transaction, TRANSACTION_KEYS, ['order_transaction']),
            ...(Array.isArray(parsed.order_items)
              ? parsed.order_items.flatMap((it, i) =>
                  missingKeys(it, ITEM_KEYS, ['order_items', i]),
                )
              : [{ path: ['order_items'], message: 'Required' }]),
          ]
        : []),
    ];
    if (missing.length > 0) return this.badRequest(MS_ERRORS.invalidBody, missing, headers);
    const b = parsed as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    const formatIssues: { path: IssuePath; message: string }[] = [];
    if (typeof b.id_order !== 'string' || !/^[A-Za-z0-9_-]+$/.test(b.id_order)) {
      formatIssues.push({ path: 'id_order', message: 'Formato inválido' });
    }
    for (const who of ['shipping_address', 'billing_address', 'customer']) {
      for (const k of ['full_name', 'first_name', 'last_name']) {
        if (typeof b[who][k] !== 'string' || !/^[\p{L} ]+$/u.test(b[who][k])) {
          formatIssues.push({ path: `${who}.${k}`, message: 'Solo letras y espacios' });
        }
      }
      if (typeof b[who].phone !== 'string' || !/^\d{10}$/.test(b[who].phone)) {
        formatIssues.push({ path: `${who}.phone`, message: 'Teléfono inválido' });
      }
    }
    if (!['cod', 'pia'].includes(b.order_transaction.payment_method)) {
      formatIssues.push({
        path: 'order_transaction.payment_method',
        message: 'Invalid enum value',
      });
    }
    if (formatIssues.length > 0)
      return this.badRequest(MS_ERRORS.invalidBody, formatIssues, headers);

    // Reglas de negocio → 400 con data null.
    const items = b.order_items as Record<string, unknown>[];
    const charges = Array.isArray(b.additional_charge)
      ? (b.additional_charge as Record<string, unknown>[])
      : [];
    const allIntegers = [
      b.order_transaction.total,
      ...items.flatMap((i) => [i.price, i.quantity]),
      ...charges.map((c) => c.value),
    ].every((n) => Number.isSafeInteger(n));
    if (!allIntegers) return this.badRequest(MS_ERRORS.totalMismatch, null, headers);
    const sum =
      items.reduce((a, i) => a + BigInt(i.price as number) * BigInt(i.quantity as number), 0n) +
      charges.reduce((a, c) => a + BigInt(c.value as number), 0n);
    if (sum !== BigInt(b.order_transaction.total)) {
      return this.badRequest(MS_ERRORS.totalMismatch, null, headers);
    }
    if (LEGAL_CURRENCY[b.shipping_address.country] !== b.order_transaction.currency) {
      return this.badRequest(MS_ERRORS.currencyNotLegal, null, headers);
    }
    const docType = b.customer.documentType;
    const docNumber = b.customer.documentNumber;
    if (
      (docType === null) !== (docNumber === null) ||
      (docType !== null && !DOC_TYPES.has(docType))
    ) {
      return this.badRequest(MS_ERRORS.documentPair, null, headers);
    }
    if (
      this.options.acceptNegativeCharges === false &&
      charges.some((c) => (c.value as number) < 0)
    ) {
      return this.json(
        500,
        {
          data: null,
          error: 'Código 400 - Cargo adicional inválido - Error interno del servidor',
          success: false,
        },
        headers,
      );
    }

    if (this.findByExternalId(b.id_order)) return this.json(500, MS_ERRORS.duplicateOrder, headers);

    const order = this.seed({
      externalOrderId: b.id_order,
      createdAt: new Date(now),
      rawBody: raw,
      body: b,
      paymentMethod: b.order_transaction.payment_method,
      totalOrder: b.order_transaction.total,
    });
    return this.json(
      200,
      {
        additionalCharge: charges,
        cancellationStatusName: null,
        customer: {
          document: docNumber,
          documentType: docType,
          email: b.customer.email,
          first_name: b.customer.first_name,
          full_name: b.customer.full_name,
          last_name: b.customer.last_name,
          phone: b.customer.phone,
          tags: b.customer.tags,
        },
        dateUpdateOrder: new Date(now).toISOString(),
        externalOrderId: order.externalOrderId,
        idOrder: order.idOrder,
        isDropshipping: false,
        orderItems: items.map((i) => ({ ...i, priceProvider: null })),
        orderTransaction: {
          currency: b.order_transaction.currency,
          payment_method: b.order_transaction.payment_method,
        },
        status: MS_STATUS_NAMES[1]!.name,
      },
      headers,
    );
  }

  private get(params: URLSearchParams, headers: Record<string, string>): Response {
    const idOrder = params.get('idOrder');
    const externalOrderId = params.get('externalOrderId');
    const tracking = params.get('carrierTrackingCode');
    const issues: { path: string; message: string }[] = [];
    if (idOrder === null && externalOrderId === null && tracking === null) {
      issues.push({
        path: 'query',
        message: 'Se requiere idOrder, externalOrderId o carrierTrackingCode',
      });
    }
    if (idOrder !== null && !/^\d+$/.test(idOrder))
      issues.push({ path: 'idOrder', message: 'Solo dígitos' });
    if (externalOrderId !== null && !/^[A-Za-z0-9-]+$/.test(externalOrderId)) {
      issues.push({ path: 'externalOrderId', message: 'Solo letras, números y guiones' });
    }
    if (tracking !== null && !/^\d+$/.test(tracking)) {
      issues.push({ path: 'carrierTrackingCode', message: 'Solo dígitos' });
    }
    if (issues.length > 0) return this.badRequest(MS_ERRORS.invalidParams, issues, headers);

    const order = [...this.orders.values()].find(
      (o) =>
        (idOrder === null || o.idOrder === Number(idOrder)) &&
        (externalOrderId === null || o.externalOrderId === externalOrderId) &&
        (tracking === null || o.carrierTrackingCode === tracking),
    );
    if (!order) return this.json(404, MS_ERRORS.orderNotFound, headers);
    const address = isObject(order.body.shipping_address) ? order.body.shipping_address : {};
    return this.json(
      200,
      {
        ...GET_ORDER_EXAMPLE,
        carrierTrackingCode: order.carrierTrackingCode,
        customer: {
          document: isObject(order.body.customer) ? order.body.customer.documentNumber : null,
        },
        externalOrderId: order.externalOrderId,
        idOrder: order.idOrder,
        orderLogistics: {
          carrierTracking: {
            guide: order.guide,
            orderTracking: order.orderTracking,
            shippingLabel: order.shippingLabel,
          },
        },
        shippingAddress: {
          ...GET_ORDER_EXAMPLE.shippingAddress,
          address: address.address1 ?? null,
          addressDetail: address.address2 ?? null,
          city: address.city ?? null,
          state: address.state ?? null,
        },
      },
      headers,
    );
  }

  private list(
    params: URLSearchParams,
    parsed: unknown,
    now: number,
    headers: Record<string, string>,
  ): Response {
    const page = Number(params.get('page') ?? '1');
    const requestedLimit = Number(params.get('limit') ?? '20');
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1
    ) {
      return this.badRequest(
        MS_ERRORS.invalidParams,
        [{ path: 'page', message: 'Inválido' }],
        headers,
      );
    }
    // Trampa: el límite se recorta en silencio a 50.
    const limit = Math.min(requestedLimit, 50);
    const filters = isObject(parsed) ? parsed : {};
    const unknown = Object.keys(filters).filter((k) => !LIST_FILTER_KEYS.includes(k));
    if (unknown.length > 0) {
      return this.badRequest(
        MS_ERRORS.invalidBody,
        unknown.map((k) => ({ path: k, message: 'Campo no permitido' })),
        headers,
      );
    }
    const statusNames = Object.values(MS_STATUS_NAMES).map((s) => s.name);
    if (filters.orderStatus !== undefined && !statusNames.includes(String(filters.orderStatus))) {
      return this.badRequest(
        MS_ERRORS.invalidBody,
        [{ path: 'orderStatus', message: 'Invalid enum value' }],
        headers,
      );
    }
    const hasFilters = Object.values(filters).some(
      (v) => v !== undefined && v !== null && v !== '',
    );
    const start = typeof filters.startDate === 'string' ? Date.parse(filters.startDate) : null;
    const end = typeof filters.finalDate === 'string' ? Date.parse(filters.finalDate) : null;

    const rows = [...this.orders.values()]
      .filter((o) => {
        const t = o.createdAt.getTime();
        // Trampa: sin filtros solo devuelve los últimos 7 días, sin avisar.
        if (!hasFilters && t < now - SEVEN_DAYS_MS) return false;
        if (start !== null && t < start) return false;
        if (end !== null && t > end) return false;
        if (filters.externalOrderId !== undefined && o.externalOrderId !== filters.externalOrderId)
          return false;
        if (filters.idOrder !== undefined && o.idOrder !== Number(filters.idOrder)) return false;
        if (
          filters.orderStatus !== undefined &&
          MS_STATUS_NAMES[o.statusId]?.name !== filters.orderStatus
        ) {
          return false;
        }
        if (filters.paymentMethod !== undefined && o.paymentMethod !== filters.paymentMethod)
          return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.idOrder - a.idOrder);

    const slice = rows.slice((page - 1) * limit, page * limit);
    return this.json(
      200,
      slice.map((o) => this.listItem(o)),
      headers,
    );
  }

  listItem(o: MockOrder): Record<string, unknown> {
    const status = MS_STATUS_NAMES[o.statusId];
    return {
      alerts: o.alerts,
      cancelReason: null,
      carrierName: o.carrierName,
      carrierTrackingCode: o.carrierTrackingCode,
      clientInfo: null,
      confirmationStatusName: null,
      createdAt: o.createdAt.toISOString(),
      currency: 'COP',
      externalOrderId: o.externalOrderId,
      hasNovelty: o.hasNovelty,
      idOrder: o.idOrder,
      items: [],
      lastCarrierStatusUpdate: null,
      orderStatus: status?.name ?? null,
      paymentMethod: o.paymentMethod,
      roleType: null,
      shipmentDate: null,
      shippingRate: o.shippingRate,
      statusParent: status?.parent ?? null,
      totalOrder: o.totalOrder,
      totalProvider: o.totalProvider,
    };
  }

  private update(rawId: string, parsed: unknown, headers: Record<string, string>): Response {
    if (!/^\d+$/.test(rawId)) {
      return this.json(
        400,
        {
          success: false,
          error: MS_ERRORS.invalidParams,
          data: [{ path: 'idOrder', message: 'Solo dígitos' }],
        },
        headers,
      );
    }
    if (!isObject(parsed))
      return this.badRequest(
        MS_ERRORS.invalidBody,
        [{ path: 'body', message: 'Requerido' }],
        headers,
      );
    const extra = Object.keys(parsed).filter((k) => !PUT_KEYS.has(k));
    if (extra.length > 0) {
      return this.json(
        400,
        {
          success: false,
          error: MS_ERRORS.invalidBody,
          data: extra.map((k) => ({ path: k, message: 'Campo no permitido' })),
        },
        headers,
      );
    }
    const order = this.orders.get(Number(rawId));
    if (!order) return this.json(404, MS_ERRORS.orderNotFound, headers);
    if (order.statusId !== 1 && order.statusId !== 2)
      return this.json(409, MS_ERRORS.notEditable, headers);
    if (parsed.idStatus !== undefined) {
      const to = parsed.idStatus;
      if (to !== 1 && to !== 2 && to !== 9) {
        return this.badRequest(
          MS_ERRORS.invalidBody,
          [{ path: 'idStatus', message: 'Invalid enum value' }],
          headers,
        );
      }
      const allowed =
        (order.statusId === 1 && (to === 2 || to === 9)) || (order.statusId === 2 && to === 9);
      if (!allowed) return this.json(409, MS_ERRORS.notEditable, headers);
      order.statusId = to;
      if (to === 2 && this.options.autoLabelOnConfirm && order.shippingLabel === null) {
        this.attachLabel(order.idOrder, `MOCK${order.idOrder}`);
      }
    }
    return this.json(
      200,
      { changedFields: Object.keys(parsed), message: 'Orden actualizada', order: null },
      headers,
    );
  }
}
