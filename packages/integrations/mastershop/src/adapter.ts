/**
 * Adaptador `CarrierProvider` (§14.1) sobre `MasterShopClient`. La lógica de negocio solo
 * conoce la interfaz; el modo A/B y la referencia del pago los da `resolveOrderOptions`
 * (desde `country_settings` y `payments`), para que el adaptador no lea la base.
 */
import type {
  CarrierOrder,
  CarrierOrderSummary,
  CarrierProvider,
  Order,
} from '@izao/core/contracts';
import { MasterShopClient } from './client';
import type { MasterShopListItem, MasterShopOrderDetail } from './client';
import { systemClock } from './clock';
import type { Clock } from './clock';
import { parseMasterShopCredentials } from './credentials';
import { MasterShopError } from './errors';
import { buildCarrierOrder } from './order';
import type { CarrierOrderOptions } from './order';
import { getMasterShopStatus, masterShopStatusFromName } from './status';

export interface MasterShopCarrierOptions {
  client: MasterShopClient;
  resolveOrderOptions(order: Order): CarrierOrderOptions | Promise<CarrierOrderOptions>;
  clock?: Clock;
  /** Fábrica de clientes para "Probar conexión" con una llave nueva. */
  createClient?: (apiKey: string) => MasterShopClient;
}

/** `statusId` 0 = el listado trajo un nombre de estado que no está en §14.6. */
export const UNKNOWN_STATUS_ID = 0;

function toSummary(item: MasterShopListItem): CarrierOrderSummary {
  return {
    providerOrderId: item.idOrder,
    externalOrderId: item.externalOrderId ?? '',
    statusId: item.statusId ?? UNKNOWN_STATUS_ID,
    statusName: item.statusName,
    statusParent: item.statusParent,
    hasNovelty: item.hasNovelty || item.alerts.length > 0,
    shippingRate: item.shippingRate,
    totalProvider: item.totalProvider,
    updatedAt: item.lastCarrierStatusUpdate ?? item.createdAt,
  };
}

export class MasterShopCarrier implements CarrierProvider {
  readonly id = 'mastershop';
  private readonly client: MasterShopClient;
  private readonly options: MasterShopCarrierOptions;
  private readonly clock: Clock;

  constructor(options: MasterShopCarrierOptions) {
    this.client = options.client;
    this.options = options;
    this.clock = options.clock ?? systemClock;
  }

  /** Para logs: sin cliente ni opciones (la llave vive en el cliente). */
  toJSON(): Record<string, string> {
    return { id: this.id };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `MasterShopCarrier { id: '${this.id}' }`;
  }

  /** Arma y envía el pedido. Lanza `CarrierOrderError` (sin red) si el pedido no es válido. */
  async createOrder(order: Order): Promise<{ providerOrderId: number; statusId: number }> {
    const opts = await this.options.resolveOrderOptions(order);
    const { body } = buildCarrierOrder(order, opts);
    const created = await this.client.createOrder(body);
    let statusId: number | undefined = created.statusName
      ? masterShopStatusFromName(created.statusName)?.id
      : undefined;
    if (statusId === undefined) {
      const summary = await this.client.findOrderSummary({ idOrder: created.idOrder });
      statusId = summary?.statusId ?? 1;
    }
    return { providerOrderId: created.idOrder, statusId };
  }

  /**
   * `PUT {idStatus: 2}`. Idempotente: si el pedido ya está confirmado o más adelante,
   * termina sin error. Tras un `502` se consulta el estado real en vez de reintentar.
   */
  async confirmOrder(providerOrderId: number): Promise<void> {
    try {
      const r = await this.client.updateOrderStatus(providerOrderId, 2);
      if (r.applied) return;
      throw this.notApplied('confirmar', r.statusId);
    } catch (e) {
      if (e instanceof MasterShopError && e.kind === 'estado_no_editable') {
        const s = await this.currentStatus(providerOrderId);
        if (s !== null && s !== 1 && s !== 9) return;
      }
      throw e;
    }
  }

  /** `PUT` con exactamente `{ idStatus: 9 }`. Idempotente si ya estaba cancelado. */
  async cancelOrder(providerOrderId: number): Promise<void> {
    try {
      const r = await this.client.updateOrderStatus(providerOrderId, 9);
      if (r.applied) return;
      throw this.notApplied('cancelar', r.statusId);
    } catch (e) {
      if (e instanceof MasterShopError && e.kind === 'estado_no_editable') {
        if ((await this.currentStatus(providerOrderId)) === 9) return;
      }
      throw e;
    }
  }

  private notApplied(action: string, statusId: number | null): MasterShopError {
    const s = statusId === null ? null : getMasterShopStatus(statusId);
    // Sigue en un estado editable: se verificó que no se aplicó, el job puede reintentar.
    const editable = statusId === 1 || statusId === 2;
    return new MasterShopError({
      kind: editable ? 'servidor' : 'estado_no_editable',
      status: 502,
      message: `MasterShop no confirmó ${action} el pedido; su estado real es ${s?.name ?? 'desconocido'}.`,
    });
  }

  private async currentStatus(providerOrderId: number): Promise<number | null> {
    const summary = await this.client.findOrderSummary({ idOrder: providerOrderId });
    return summary?.statusId ?? null;
  }

  /** Detalle (guía, rastreo, etiqueta) + resumen del listado (estado, novedad, tarifas). */
  async getOrder(ref: {
    externalOrderId?: string;
    providerOrderId?: number;
  }): Promise<CarrierOrder> {
    const detail: MasterShopOrderDetail = await this.client.getOrder(
      ref.providerOrderId !== undefined
        ? { idOrder: ref.providerOrderId }
        : ref.externalOrderId !== undefined
          ? { externalOrderId: ref.externalOrderId }
          : {},
    );
    const summary = await this.client.findOrderSummary({ idOrder: detail.idOrder });
    const statusId = detail.statusId ?? summary?.statusId ?? null;
    if (statusId === null) {
      throw new MasterShopError({
        kind: 'respuesta_invalida',
        message: `No se pudo determinar el estado del pedido ${detail.idOrder} en MasterShop.`,
      });
    }
    const status = getMasterShopStatus(statusId);
    return {
      providerOrderId: detail.idOrder,
      externalOrderId:
        detail.externalOrderId ?? summary?.externalOrderId ?? ref.externalOrderId ?? '',
      statusId,
      statusName: summary?.statusName ?? status?.filterName ?? null,
      statusParent: summary?.statusParent ?? status?.group ?? null,
      hasNovelty: summary ? summary.hasNovelty || summary.alerts.length > 0 : false,
      shippingRate: summary?.shippingRate ?? null,
      totalProvider: summary?.totalProvider ?? null,
      updatedAt: summary?.lastCarrierStatusUpdate ?? summary?.createdAt ?? null,
      carrierName: summary?.carrierName ?? null,
      trackingCode: detail.guide ?? detail.trackingCode ?? summary?.trackingCode ?? null,
      trackingUrl: detail.trackingUrl,
      labelUrl: detail.labelUrl,
      alerts: summary?.alerts ?? [],
      raw: { detail: detail.raw, summary: summary?.raw ?? null },
    };
  }

  /** Una página del listado (50 por página), siempre con `startDate`. */
  async listOrders(filter: { startDate: Date; page: number }): Promise<CarrierOrderSummary[]> {
    const rows = await this.client.listOrders({ startDate: filter.startDate, page: filter.page });
    return rows.map(toSummary);
  }

  async testCredentials(creds: unknown): Promise<{ ok: boolean; message: string }> {
    const parsed = parseMasterShopCredentials(creds);
    if (parsed === null) return { ok: false, message: 'Falta la llave de API de MasterShop.' };
    const client = this.options.createClient
      ? this.options.createClient(parsed.apiKey)
      : new MasterShopClient({ apiKey: parsed.apiKey, clock: this.clock });
    return client.testCredentials();
  }
}
