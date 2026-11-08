/**
 * Fuente en memoria para las pruebas de la cola `carrier`. Reproduce el contrato de
 * `aplicar_transicion_pedido` (update condicional por estado; `true` si ya estaba en el destino).
 */
import type { Order } from '@izao/core/contracts';
import type { OrderStatus } from '@izao/core/order-state';
import type { CountryCode } from '@izao/core/money';
import type { MasterShopCredentials } from '@izao/mastershop';
import type {
  AjustesTransportadora,
  CambiosEnvio,
  EnvioFila,
  FuenteCarrier,
  PagoAprobado,
  ProgramadorCarrier,
  ResultadoWebhook,
} from './fuente.js';

export interface EventoMemoria {
  order_id: string;
  type: string;
  actor: string;
  from_status?: OrderStatus;
  to_status?: OrderStatus;
  payload: Record<string, unknown>;
}

export class FuenteMemoria implements FuenteCarrier {
  readonly pedidos = new Map<string, Order>();
  readonly envios = new Map<string, EnvioFila & { historial: unknown[]; extra: Partial<CambiosEnvio> }>();
  readonly eventos: EventoMemoria[] = [];
  readonly impresiones: { order_id: string; shipment_id: string }[] = [];
  readonly webhooks = new Map<string, ResultadoWebhook>();
  readonly fechas: Record<string, Record<string, Date | undefined>> = {};
  ajustesPais: AjustesTransportadora | null = { proveedor: 'mastershop', autoConfirmar: true, modo: 'prorate' };
  creds: MasterShopCredentials | null = { apiKey: 'clave-de-prueba' };
  pago: PagoAprobado | null = { provider: 'wompi', referencia: 'ref-1' };
  /** Simula que otro proceso mueve el pedido justo antes de la próxima transición. */
  moverAntes: OrderStatus | null = null;

  agregar(o: Order): void {
    this.pedidos.set(o.id, structuredClone(o));
  }

  estado(id: string): OrderStatus | undefined {
    return this.pedidos.get(id)?.status;
  }

  tipos(id: string): string[] {
    return this.eventos.filter((e) => e.order_id === id).map((e) => (e.type === 'alerta' ? `alerta:${String(e.payload.motivo)}` : e.type === 'status_changed' ? `${e.from_status}>${e.to_status}` : `${e.type}:${String(e.payload.accion)}`));
  }

  async pedido(id: string) {
    const o = this.pedidos.get(id);
    return o ? structuredClone(o) : null;
  }
  async pedidoPorNumero(n: string) {
    for (const o of this.pedidos.values()) if (o.number === n) return o.id;
    return null;
  }
  async pedidoPorIdProveedor(pid: number) {
    for (const e of this.envios.values()) if (e.provider_order_id === pid) return e.order_id;
    return null;
  }
  async ajustes() {
    return this.ajustesPais;
  }
  async pagoAprobado() {
    return this.pago;
  }
  async credenciales(_pais: CountryCode) {
    return this.creds;
  }
  async envio(id: string) {
    const e = this.envios.get(id);
    if (!e) return null;
    return {
      id: e.id,
      order_id: e.order_id,
      external_order_id: e.external_order_id,
      provider_order_id: e.provider_order_id,
      provider_status_id: e.provider_status_id,
      tracking_code: e.tracking_code,
      label_url: e.label_url,
      label_local_path: e.label_local_path,
      shipping_rate: e.extra.shipping_rate ?? null,
    };
  }
  async guardarEnvio(id: string, c: CambiosEnvio) {
    const previo = this.envios.get(id) ?? {
      id: `env-${id}`,
      order_id: id,
      external_order_id: c.external_order_id,
      provider_order_id: null,
      provider_status_id: null,
      tracking_code: null,
      label_url: null,
      label_local_path: null,
      historial: [],
      extra: {},
    };
    const { historial, ...resto } = c;
    const def = <T>(v: T | undefined, p: T): T => (v === undefined ? p : v);
    const nuevo = {
      ...previo,
      external_order_id: c.external_order_id,
      provider_order_id: def(c.provider_order_id, previo.provider_order_id),
      provider_status_id: def(c.provider_status_id, previo.provider_status_id),
      tracking_code: def(c.tracking_code, previo.tracking_code),
      label_url: def(c.label_url, previo.label_url),
      label_local_path: def(c.label_local_path, previo.label_local_path),
      historial: historial ? [...previo.historial, historial] : previo.historial,
      extra: { ...previo.extra, ...resto },
    };
    this.envios.set(id, nuevo);
    return (await this.envio(id))!;
  }
  async aplicarTransicion(id: string, ev: { from_status: OrderStatus; to_status: OrderStatus; actor: string; payload: unknown }, fechas = {}) {
    const o = this.pedidos.get(id);
    if (!o) throw new Error('pedido_inexistente');
    if (this.moverAntes) {
      o.status = this.moverAntes;
      this.moverAntes = null;
    }
    if (o.status !== ev.from_status) return o.status === ev.to_status;
    o.status = ev.to_status;
    this.fechas[id] = { ...this.fechas[id], ...fechas };
    this.eventos.push({ order_id: id, type: 'status_changed', actor: ev.actor, from_status: ev.from_status, to_status: ev.to_status, payload: ev.payload as Record<string, unknown> });
    return true;
  }
  async registrarEvento(id: string, type: 'alerta' | 'transportadora', actor: string, payload: Record<string, unknown>) {
    this.eventos.push({ order_id: id, type, actor, payload });
  }
  async crearImpresionEtiqueta(order_id: string, shipment_id: string) {
    if (this.impresiones.some((p) => p.shipment_id === shipment_id)) return false;
    this.impresiones.push({ order_id, shipment_id });
    return true;
  }
  async marcarWebhook(id: string, r: ResultadoWebhook) {
    this.webhooks.set(id, r);
  }
}

/** Programador que guarda los jobs para que la prueba los ejecute a mano. */
export class ProgramadorMemoria implements ProgramadorCarrier {
  readonly jobs: { tipo: 'crear' | 'etiqueta'; order_id: string; intento: number; espera: number }[] = [];
  async crear(order_id: string, intento: number, espera: number) {
    this.jobs.push({ tipo: 'crear', order_id, intento, espera });
  }
  async etiqueta(order_id: string, intento: number, espera: number) {
    this.jobs.push({ tipo: 'etiqueta', order_id, intento, espera });
  }
  sacar(tipo: 'crear' | 'etiqueta') {
    const i = this.jobs.findIndex((j) => j.tipo === tipo);
    return i < 0 ? undefined : this.jobs.splice(i, 1)[0];
  }
}
