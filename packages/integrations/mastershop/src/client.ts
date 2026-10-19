/**
 * Cliente HTTP de la API pública de MasterShop (§14.2). `fetch` y reloj inyectables:
 * las pruebas corren contra `MasterShopMock` sin red.
 *
 * Responsabilidades del cliente (dentro de una misma llamada):
 * - `ms-api-key`, JSON y tiempo de espera explícito (10 s por defecto).
 * - `RateLimit-*`: si quedan 0 solicitudes espera el reinicio; en `429` espera
 *   `RateLimit-Reset` y reintenta (pocas veces) antes de rendirse.
 * - `500` "409 - La orden ya existe" al crear → se trata como creado y se consulta.
 * - `409` por edición concurrente en `PUT` → reintenta a los 5 s.
 * - `502` en `PUT` → NO reintenta: consulta el pedido y devuelve el estado real.
 *
 * Los reintentos largos (30 s … 2 h) son del job, con `planCarrierRetry`.
 */
import { fromDbAmount } from '@izao/core/money';
import { z } from 'zod';
import { systemClock } from './clock';
import type { Clock } from './clock';
import {
  CONCURRENT_EDIT_PATTERN,
  DUPLICATE_ORDER_PATTERN,
  MasterShopError,
  platformClientErrorCode,
} from './errors';
import type { MasterShopErrorKind } from './errors';
import { serializeMasterShopJson } from './json';
import { MasterShopOrderBodySchema, ORDER_NUMBER_PATTERN } from './order';
import type { MasterShopOrderBody } from './order';
import { parseRateLimit, RateLimitGate, resetDelayMs } from './rate-limit';
import { noveltyBadge, resolveMasterShopStatus } from './status';
import type { MasterShopAlert } from './status';

export const MASTERSHOP_BASE_URL = 'https://prod.api.mastershop.com';
/** Máximo real de `limit` en el listado: más se recorta en silencio. */
export const MASTERSHOP_MAX_PAGE_SIZE = 50;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MasterShopClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  clock?: Clock;
  /** Tiempo de espera por solicitud (ms). */
  timeoutMs?: number;
  /** Espera antes de reintentar un `409` por edición concurrente (ms). */
  concurrentEditRetryMs?: number;
  maxConcurrentEditRetries?: number;
  /** Veces que se espera `RateLimit-Reset` dentro de una llamada antes de rendirse. */
  maxRateLimitWaits?: number;
  /** Espera si un `429` no trae `RateLimit-Reset` (ms). */
  rateLimitFallbackMs?: number;
  /** Tope de páginas en `listAllOrders` (defensa contra bucles). */
  maxPages?: number;
}

// ---------------------------------------------------------------------------
// Formas de respuesta (tolerantes: solo se exige lo que se usa)
// ---------------------------------------------------------------------------

const idSchema = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]);
const optText = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

const CreateResponseSchema = z.looseObject({
  idOrder: idSchema,
  externalOrderId: optText,
  status: optText,
});

const DetailSchema = z.looseObject({
  idOrder: idSchema,
  externalOrderId: optText,
  carrierTrackingCode: z.union([z.string(), z.number()]).nullish(),
  orderLogistics: z
    .looseObject({
      carrierTracking: z
        .looseObject({ guide: z.unknown(), orderTracking: optText, shippingLabel: optText })
        .nullish(),
    })
    .nullish(),
  // `[VERIFICAR]`: la documentación no incluye el estado en el detalle.
  idStatus: z.unknown().optional(),
  status: z.unknown().optional(),
  orderStatus: z.unknown().optional(),
});

const ListItemSchema = z.looseObject({
  idOrder: idSchema,
  externalOrderId: optText,
  orderStatus: optText,
  statusParent: optText,
  hasNovelty: z.boolean().nullish(),
  alerts: z.unknown().optional(),
  carrierName: optText,
  carrierTrackingCode: z.union([z.string(), z.number()]).nullish(),
  shippingRate: z.unknown().optional(),
  totalProvider: z.unknown().optional(),
  totalOrder: z.unknown().optional(),
  createdAt: optText,
  lastCarrierStatusUpdate: optText,
});

export interface CreateOrderResult {
  idOrder: number;
  externalOrderId: string;
  statusName: string | null;
  /** MasterShop respondió "La orden ya existe": no se creó otra; se consultó la existente. */
  duplicated: boolean;
}

export interface MasterShopOrderDetail {
  idOrder: number;
  externalOrderId: string | null;
  trackingCode: string | null;
  guide: string | null;
  trackingUrl: string | null;
  /** `shippingLabel`: URL del PDF de la guía. */
  labelUrl: string | null;
  /** Solo si la respuesta trae el estado (`[VERIFICAR]`). */
  statusId: number | null;
  raw: unknown;
}

export interface MasterShopListItem {
  idOrder: number;
  externalOrderId: string | null;
  statusName: string | null;
  statusParent: string | null;
  /** Resuelto desde `orderStatus`; `null` si el nombre no está en la tabla de §14.6. */
  statusId: number | null;
  hasNovelty: boolean;
  alerts: MasterShopAlert[];
  carrierName: string | null;
  trackingCode: string | null;
  shippingRate: bigint | null;
  totalProvider: bigint | null;
  totalOrder: bigint | null;
  createdAt: string | null;
  lastCarrierStatusUpdate: string | null;
  raw: unknown;
}

export interface ListOrdersFilter {
  /** Obligatorio: sin filtros MasterShop devuelve solo los últimos 7 días. */
  startDate: Date;
  finalDate?: Date;
  externalOrderId?: string;
  idOrder?: number;
  orderStatus?: string;
  orderStatusParent?: string;
  paymentMethod?: 'cod' | 'pia';
}

export interface UpdateStatusResult {
  /** Si el pedido quedó en el estado pedido (o más adelante, al confirmar). */
  applied: boolean;
  /** Estado real tras la operación, si se conoce. */
  statusId: number | null;
  /** `respuesta`: lo dijo el `200`; `consulta`: se consultó tras un `502`. */
  via: 'respuesta' | 'consulta';
}

interface RawResponse {
  status: number;
  data: unknown;
  headers: Headers;
}

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Monto COP de la API (número entero o texto de dígitos) → bigint; `null` si no viene. */
function amount(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'bigint') return null;
  try {
    return fromDbAmount(v);
  } catch {
    throw new MasterShopError({
      kind: 'respuesta_invalida',
      message: `MasterShop devolvió un monto no entero: ${String(v)}.`,
    });
  }
}

function providerError(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const e = (data as { error: unknown }).error;
    return typeof e === 'string' ? e : null;
  }
  return typeof data === 'string' && data !== '' ? data : null;
}

function providerData(data: unknown): unknown {
  return typeof data === 'object' && data !== null && 'data' in data
    ? (data as { data: unknown }).data
    : undefined;
}

const FRIENDLY: Record<MasterShopErrorKind, string> = {
  validacion: 'MasterShop rechazó los datos del pedido.',
  autenticacion: 'La llave de API de MasterShop no es válida o no tiene permiso.',
  no_encontrado: 'El pedido no existe en MasterShop.',
  edicion_concurrente: 'MasterShop está actualizando el pedido; se intentará de nuevo.',
  estado_no_editable: 'El pedido ya no se puede modificar en MasterShop por su estado.',
  rechazado: 'MasterShop rechazó la actualización; el pedido no cambió.',
  limite: 'Se alcanzó el límite de solicitudes de MasterShop.',
  servidor: 'MasterShop tuvo un error interno.',
  no_confirmado: 'MasterShop no confirmó si aplicó el cambio.',
  red: 'No fue posible conectar con MasterShop.',
  tiempo_agotado: 'MasterShop no respondió a tiempo.',
  respuesta_invalida: 'MasterShop devolvió una respuesta inesperada.',
};

export class MasterShopClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly concurrentEditRetryMs: number;
  private readonly maxConcurrentEditRetries: number;
  private readonly maxRateLimitWaits: number;
  private readonly rateLimitFallbackMs: number;
  private readonly maxPages: number;
  private readonly gate = new RateLimitGate();

  constructor(options: MasterShopClientOptions) {
    if (options.apiKey.trim() === '') throw new Error('Falta la llave de API de MasterShop.');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = (options.baseUrl ?? MASTERSHOP_BASE_URL).replace(/\/+$/, '');
    this.clock = options.clock ?? systemClock;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.concurrentEditRetryMs = options.concurrentEditRetryMs ?? 5_000;
    this.maxConcurrentEditRetries = options.maxConcurrentEditRetries ?? 3;
    this.maxRateLimitWaits = options.maxRateLimitWaits ?? 2;
    this.rateLimitFallbackMs = options.rateLimitFallbackMs ?? 60_000;
    this.maxPages = options.maxPages ?? 200;
  }

  // -------------------------------------------------------------------------
  // Transporte
  // -------------------------------------------------------------------------

  private async send(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    opts: { query?: Record<string, string>; body?: string } = {},
  ): Promise<RawResponse> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    for (let waits = 0; ; waits++) {
      const wait = this.gate.waitMs(this.clock.now());
      if (wait > 0) await this.clock.sleep(wait);

      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method,
          headers: {
            'ms-api-key': this.apiKey,
            accept: 'application/json',
            ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: opts.body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        const timeout =
          cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
        const kind = timeout ? 'tiempo_agotado' : 'red';
        throw new MasterShopError({ kind, message: FRIENDLY[kind], cause });
      }

      const info = parseRateLimit(response.headers);
      const now = this.clock.now();
      this.gate.observe(info, now);
      const raw = await response.text();
      let data: unknown = raw;
      if (raw !== '') {
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
      }

      if (response.status === 429) {
        const delay = resetDelayMs(info, this.rateLimitFallbackMs);
        if (waits < this.maxRateLimitWaits) {
          this.gate.blockUntil(now + delay);
          continue;
        }
        throw new MasterShopError({
          kind: 'limite',
          status: 429,
          message: FRIENDLY.limite,
          providerMessage: providerError(data),
          retryAfterMs: delay,
        });
      }
      return { status: response.status, data, headers: response.headers };
    }
  }

  private fail(res: RawResponse, method: string): MasterShopError {
    const msg = providerError(res.data);
    let kind: MasterShopErrorKind;
    switch (res.status) {
      case 400:
        kind = 'validacion';
        break;
      case 401:
      case 403:
        kind = 'autenticacion';
        break;
      case 404:
        kind = 'no_encontrado';
        break;
      case 409:
        kind =
          msg !== null && CONCURRENT_EDIT_PATTERN.test(msg)
            ? 'edicion_concurrente'
            : 'estado_no_editable';
        break;
      case 422:
        kind = 'rechazado';
        break;
      case 502:
        kind = method === 'PUT' ? 'no_confirmado' : 'servidor';
        break;
      default:
        // M4: un 500 que trae un código 4xx de la plataforma es un rechazo definitivo
        // (reintentarlo daría lo mismo). El duplicado "409 - La orden ya existe" se
        // atiende antes, en createOrder.
        kind =
          res.status >= 500
            ? platformClientErrorCode(msg) !== null
              ? 'validacion'
              : 'servidor'
            : 'respuesta_invalida';
    }
    return new MasterShopError({
      kind,
      status: res.status,
      message: FRIENDLY[kind],
      providerMessage: msg,
      providerData: providerData(res.data),
    });
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
    const r = schema.safeParse(data);
    if (!r.success) {
      throw new MasterShopError({
        kind: 'respuesta_invalida',
        message: `${FRIENDLY.respuesta_invalida} (${what})`,
        providerData: r.error.issues,
      });
    }
    return r.data;
  }

  // -------------------------------------------------------------------------
  // Pedidos
  // -------------------------------------------------------------------------

  /** `POST /api/orders`. Un "ya existe" se trata como creado y se consulta (§14.5). */
  async createOrder(body: MasterShopOrderBody): Promise<CreateOrderResult> {
    const check = MasterShopOrderBodySchema.safeParse(body);
    if (!check.success) {
      throw new MasterShopError({
        kind: 'validacion',
        message: 'El pedido no cumple el esquema de MasterShop; no se envió.',
        providerData: check.error.issues,
      });
    }
    const res = await this.send('POST', '/api/orders', {
      body: serializeMasterShopJson(body, body.order_transaction.currency),
    });
    if (res.status === 200 || res.status === 201) {
      const r = this.parse(CreateResponseSchema, res.data, 'crear pedido');
      return {
        idOrder: r.idOrder,
        externalOrderId: r.externalOrderId ?? body.id_order,
        statusName: r.status,
        duplicated: false,
      };
    }
    const msg = providerError(res.data);
    if (res.status === 500 && msg !== null && DUPLICATE_ORDER_PATTERN.test(msg)) {
      const existing = await this.getOrder({ externalOrderId: body.id_order });
      return {
        idOrder: existing.idOrder,
        externalOrderId: existing.externalOrderId ?? body.id_order,
        statusName: null,
        duplicated: true,
      };
    }
    throw this.fail(res, 'POST');
  }

  /** `GET /api/orders` por `idOrder`, `externalOrderId` o `carrierTrackingCode`. */
  async getOrder(ref: {
    idOrder?: number;
    externalOrderId?: string;
    carrierTrackingCode?: string;
  }): Promise<MasterShopOrderDetail> {
    const query: Record<string, string> = {};
    if (ref.idOrder !== undefined) {
      if (!Number.isSafeInteger(ref.idOrder) || ref.idOrder <= 0) {
        throw new MasterShopError({
          kind: 'validacion',
          message: 'idOrder debe ser un entero positivo.',
        });
      }
      query.idOrder = String(ref.idOrder);
    }
    if (ref.externalOrderId !== undefined) {
      if (!ORDER_NUMBER_PATTERN.test(ref.externalOrderId)) {
        throw new MasterShopError({
          kind: 'validacion',
          message: 'externalOrderId solo admite letras, números y guiones (sin guion bajo).',
        });
      }
      query.externalOrderId = ref.externalOrderId;
    }
    if (ref.carrierTrackingCode !== undefined) {
      if (!/^\d+$/.test(ref.carrierTrackingCode)) {
        throw new MasterShopError({ kind: 'validacion', message: 'La guía solo admite dígitos.' });
      }
      query.carrierTrackingCode = ref.carrierTrackingCode;
    }
    if (Object.keys(query).length === 0) {
      throw new MasterShopError({
        kind: 'validacion',
        message: 'Se requiere idOrder, externalOrderId o carrierTrackingCode.',
      });
    }
    const res = await this.send('GET', '/api/orders', { query });
    if (res.status !== 200) throw this.fail(res, 'GET');
    const d = this.parse(DetailSchema, res.data, 'consultar pedido');
    const tracking = d.orderLogistics?.carrierTracking ?? null;
    const status = resolveMasterShopStatus({
      id: typeof d.idStatus === 'number' || typeof d.idStatus === 'string' ? d.idStatus : null,
      name:
        typeof d.orderStatus === 'string'
          ? d.orderStatus
          : typeof d.status === 'string'
            ? d.status
            : null,
    });
    return {
      idOrder: d.idOrder,
      externalOrderId: d.externalOrderId,
      trackingCode: text(d.carrierTrackingCode),
      guide: text(tracking?.guide),
      trackingUrl: tracking?.orderTracking ?? null,
      labelUrl: tracking?.shippingLabel ?? null,
      statusId: status?.id ?? null,
      raw: res.data,
    };
  }

  /** Una página de `POST /api/orders/list`. Siempre con `startDate`; `limit` ≤ 50. */
  async listOrders(
    filter: ListOrdersFilter & { page: number; limit?: number },
  ): Promise<MasterShopListItem[]> {
    if (!(filter.startDate instanceof Date) || Number.isNaN(filter.startDate.getTime())) {
      throw new MasterShopError({
        kind: 'validacion',
        message: 'startDate es obligatorio: sin filtros MasterShop solo devuelve 7 días.',
      });
    }
    if (!Number.isInteger(filter.page) || filter.page < 1) {
      throw new MasterShopError({ kind: 'validacion', message: 'page debe ser un entero ≥ 1.' });
    }
    const limit = Math.min(filter.limit ?? MASTERSHOP_MAX_PAGE_SIZE, MASTERSHOP_MAX_PAGE_SIZE);
    const body: Record<string, unknown> = { startDate: filter.startDate.toISOString() };
    if (filter.finalDate) body.finalDate = filter.finalDate.toISOString();
    if (filter.externalOrderId !== undefined) body.externalOrderId = filter.externalOrderId;
    if (filter.idOrder !== undefined) body.idOrder = filter.idOrder;
    if (filter.orderStatus !== undefined) body.orderStatus = filter.orderStatus;
    if (filter.orderStatusParent !== undefined) body.orderStatusParent = filter.orderStatusParent;
    if (filter.paymentMethod !== undefined) body.paymentMethod = filter.paymentMethod;
    return this.listPage(body, filter.page, limit);
  }

  private async listPage(
    body: Record<string, unknown>,
    page: number,
    limit: number,
  ): Promise<MasterShopListItem[]> {
    const res = await this.send('POST', '/api/orders/list', {
      query: { page: String(page), limit: String(limit) },
      body: JSON.stringify(body),
    });
    if (res.status !== 200) throw this.fail(res, 'POST');
    const rows = this.parse(z.array(ListItemSchema), res.data, 'listar pedidos');
    return rows.map((r) => {
      const badge = noveltyBadge({ hasNovelty: r.hasNovelty, alerts: r.alerts });
      return {
        idOrder: r.idOrder,
        externalOrderId: r.externalOrderId,
        statusName: r.orderStatus,
        statusParent: r.statusParent,
        statusId:
          r.orderStatus === null
            ? null
            : (resolveMasterShopStatus({ name: r.orderStatus })?.id ?? null),
        hasNovelty: r.hasNovelty === true,
        alerts: badge.alerts,
        carrierName: r.carrierName,
        trackingCode: text(r.carrierTrackingCode),
        shippingRate: amount(r.shippingRate),
        totalProvider: amount(r.totalProvider),
        totalOrder: amount(r.totalOrder),
        createdAt: r.createdAt,
        lastCarrierStatusUpdate: r.lastCarrierStatusUpdate,
        raw: r,
      };
    });
  }

  /**
   * Todas las páginas hasta recibir una vacía. No se detiene en una página "corta":
   * MasterShop recorta `limit` en silencio, así que una página menor que lo pedido no
   * significa que se acabó.
   */
  async listAllOrders(filter: ListOrdersFilter): Promise<MasterShopListItem[]> {
    const all: MasterShopListItem[] = [];
    const seen = new Set<number>();
    for (let page = 1; page <= this.maxPages; page++) {
      const rows = await this.listOrders({ ...filter, page });
      if (rows.length === 0) return all;
      for (const r of rows) {
        if (seen.has(r.idOrder)) continue;
        seen.add(r.idOrder);
        all.push(r);
      }
    }
    throw new MasterShopError({
      kind: 'respuesta_invalida',
      message: `El listado de MasterShop superó ${this.maxPages} páginas.`,
    });
  }

  /**
   * Resumen (estado, novedad, tarifas) de un pedido desde el listado. Basta el filtro
   * por `idOrder` o `externalOrderId`: la colección documenta que cualquier filtro
   * quita la ventana de 7 días, así que no se acota por fecha (un pedido viejo sigue
   * apareciendo).
   */
  async findOrderSummary(ref: {
    idOrder?: number;
    externalOrderId?: string;
  }): Promise<MasterShopListItem | null> {
    const body: Record<string, unknown> = {};
    if (ref.idOrder !== undefined) body.idOrder = ref.idOrder;
    if (ref.externalOrderId !== undefined) body.externalOrderId = ref.externalOrderId;
    if (Object.keys(body).length === 0) {
      throw new MasterShopError({
        kind: 'validacion',
        message: 'Se requiere idOrder o externalOrderId para buscar el pedido.',
      });
    }
    const rows = await this.listPage(body, 1, MASTERSHOP_MAX_PAGE_SIZE);
    return (
      rows.find(
        (r) =>
          (ref.idOrder === undefined || r.idOrder === ref.idOrder) &&
          (ref.externalOrderId === undefined || r.externalOrderId === ref.externalOrderId),
      ) ?? null
    );
  }

  /**
   * `PUT /api/orders/{idOrder}` con `{ idStatus }` (2 confirmar, 9 cancelar).
   * - `409` concurrente → espera y reintenta.
   * - `502` → no reintenta: consulta el listado y devuelve el estado real.
   */
  async updateOrderStatus(idOrder: number, idStatus: 2 | 9): Promise<UpdateStatusResult> {
    if (!Number.isSafeInteger(idOrder) || idOrder <= 0) {
      throw new MasterShopError({
        kind: 'validacion',
        message: 'idOrder debe ser un entero positivo.',
      });
    }
    for (let retries = 0; ; retries++) {
      const res = await this.send('PUT', `/api/orders/${idOrder}`, {
        body: JSON.stringify({ idStatus }),
      });
      if (res.status === 200) return { applied: true, statusId: idStatus, via: 'respuesta' };
      const error = this.fail(res, 'PUT');
      if (error.kind === 'edicion_concurrente' && retries < this.maxConcurrentEditRetries) {
        await this.clock.sleep(this.concurrentEditRetryMs);
        continue;
      }
      if (error.kind === 'no_confirmado') {
        const summary = await this.findOrderSummary({ idOrder });
        if (summary === null || summary.statusId === null) throw error;
        const s = summary.statusId;
        const applied = idStatus === 9 ? s === 9 : s !== 1 && s !== 9;
        return { applied, statusId: s, via: 'consulta' };
      }
      throw error;
    }
  }

  /** Prueba la llave con una lectura inocua (`GET /api/products`). */
  async testCredentials(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.send('GET', '/api/products', { query: { page: '1' } });
      if (res.status === 200) return { ok: true, message: 'Conexión con MasterShop correcta.' };
      const e = this.fail(res, 'GET');
      return { ok: false, message: e.message };
    } catch (e) {
      if (e instanceof MasterShopError) return { ok: false, message: e.message };
      throw e;
    }
  }
}
