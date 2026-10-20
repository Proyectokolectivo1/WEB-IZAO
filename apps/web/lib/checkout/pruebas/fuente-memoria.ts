/**
 * Fuente del checkout en memoria, solo para pruebas. Imita el comportamiento de las funciones de la base
 * (`reservar_stock`, `reservar_canje`, sus liberaciones) y la clave única de idempotencia.
 */
import type { CountryCode } from '@izao/core/money';
import type { PricingDiscountCode } from '@izao/core/pricing';
import type { OrderStatus } from '@izao/core/order-state';
import type {
  ConfigPais,
  EventoPedido,
  FilaItem,
  FilaPedido,
  FuenteCheckout,
  PedidoCreado,
  ResultadoInsertarPedido,
  UbicacionEnvio,
  VarianteCheckout,
} from '../fuente';

type Operacion = keyof FuenteCheckout;

interface PedidoGuardado {
  fila: FilaPedido;
  pedido: Omit<PedidoCreado, 'lines'>;
  items: FilaItem[];
  stock: 'none' | 'reserved' | 'released';
  canje: 'none' | 'reserved' | 'released';
}

export const ID_PEDIDO = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export class FuenteMemoria implements FuenteCheckout {
  readonly config = new Map<CountryCode, ConfigPais>();
  readonly vars = new Map<string, VarianteCheckout & { pais: CountryCode }>();
  readonly codigos: (PricingDiscountCode & { usos_cliente?: Record<string, number> })[] = [];
  readonly ubicaciones: (UbicacionEnvio & { pais: CountryCode })[] = [];
  readonly pedidos = new Map<string, PedidoGuardado>();
  readonly eventos: { orderId: string; evento: EventoPedido }[] = [];
  readonly eliminados: string[] = [];
  /** Operaciones que lanzan un error simulado. */
  readonly fallar = new Set<Operacion>();
  /** Fuerza el rechazo de `reservar_canje` con este motivo. */
  canjeRechazo: 'limite_por_cliente' | 'limite_total' | 'codigo_fuera_de_vigencia' | null = null;
  /** Usos previos del cliente que devuelve `usosDelCliente`. */
  usosPrevios = 0;
  llamadas: Operacion[] = [];
  private secuencia = 0;

  private marca(op: Operacion) {
    this.llamadas.push(op);
    if (this.fallar.has(op)) throw new Error(`fallo simulado en ${op}`);
  }

  async configPais(pais: CountryCode) {
    this.marca('configPais');
    return this.config.get(pais) ?? null;
  }

  async variantes(pais: CountryCode, ids: readonly string[]) {
    this.marca('variantes');
    const m = new Map<string, VarianteCheckout>();
    for (const id of ids) {
      const v = this.vars.get(id);
      if (!v) continue;
      if (v.pais !== pais) {
        m.set(id, { ...v, vendible: false, precio: null, tachado: null, costo: null, disponible: 0 });
      } else {
        m.set(id, { ...v });
      }
    }
    return m;
  }

  async codigo(texto: string) {
    this.marca('codigo');
    const c = this.codigos.find((x) => x.code === texto);
    return c ? { ...c, customer_usage_count: null } : null;
  }

  async usosDelCliente() {
    this.marca('usosDelCliente');
    return this.usosPrevios;
  }

  async ubicacion(pais: CountryCode, regionId: string, cityId: string) {
    this.marca('ubicacion');
    const u = this.ubicaciones.find((x) => x.pais === pais && x.region_id === regionId && x.city_id === cityId);
    if (!u) return null;
    return { region_id: u.region_id, region_nombre: u.region_nombre, city_id: u.city_id, city_nombre: u.city_nombre };
  }

  async pedidoPorIdempotencia(clave: string) {
    this.marca('pedidoPorIdempotencia');
    for (const p of this.pedidos.values()) {
      if (p.fila.checkout_idempotency_key === clave) {
        const completo = this.eventos.some((e) => e.orderId === p.pedido.id && e.evento.type === 'created');
        return { ...this.resumen(p), completo };
      }
    }
    return null;
  }

  private resumen(p: PedidoGuardado): PedidoCreado {
    return {
      ...p.pedido,
      lines: p.items.map((i) => ({
        variant_id: i.variant_id as string,
        name: i.name_snapshot as string,
        variant_label: (i.variant_label as string | null) ?? null,
        quantity: i.quantity as number,
        unit_price: BigInt(i.unit_price as string),
        line_discount: BigInt(i.line_discount as string),
      })),
    };
  }

  async insertarPedido(fila: FilaPedido): Promise<ResultadoInsertarPedido> {
    this.marca('insertarPedido');
    for (const p of this.pedidos.values()) {
      if (p.fila.checkout_idempotency_key === fila.checkout_idempotency_key) return { ok: false, motivo: 'duplicado' };
    }
    this.secuencia += 1;
    const id = ID_PEDIDO(this.secuencia);
    const pais = fila.country_code as CountryCode;
    const pedido: Omit<PedidoCreado, 'lines'> = {
      id,
      number: `IZ-${pais}-${String(this.secuencia).padStart(6, '0')}`,
      public_token: `tok${this.secuencia}`,
      status: fila.status as OrderStatus,
      country_code: pais,
      currency_code: fila.currency_code as 'COP' | 'USD',
      payment_method: fila.payment_method as PedidoCreado['payment_method'],
      subtotal: BigInt(fila.subtotal as string),
      discount: BigInt(fila.discount_amount as string),
      surcharge: BigInt(fila.financing_surcharge_amount as string),
      total_customer: BigInt(fila.total_customer as string),
      cod_deposit: BigInt(fila.cod_deposit_amount as string),
      cod_collect: BigInt(fila.cod_collect_amount as string),
    };
    // Mismas restricciones que la tabla
    if (pedido.total_customer !== pedido.subtotal - pedido.discount + pedido.surcharge) {
      throw new Error('orders_total_check');
    }
    if (pedido.payment_method === 'cod' && pedido.cod_collect !== pedido.total_customer - pedido.cod_deposit) {
      throw new Error('orders_cod_check');
    }
    this.pedidos.set(id, { fila, pedido, items: [], stock: 'none', canje: 'none' });
    return { ok: true, pedido };
  }

  async insertarItems(orderId: string, items: readonly FilaItem[]) {
    this.marca('insertarItems');
    this.pedidos.get(orderId)!.items.push(...items);
  }

  async reservarStock(orderId: string) {
    this.marca('reservarStock');
    const p = this.pedidos.get(orderId);
    if (!p) return { ok: false as const, estado: null, motivo: 'pedido_inexistente' as const };
    if (p.stock === 'reserved') return { ok: true as const, estado: 'reserved' as const, repetido: true as const };
    const faltantes = p.items.flatMap((i) => {
      const v = this.vars.get(i.variant_id as string);
      const disp = v ? v.disponible : 0;
      return disp < (i.quantity as number)
        ? [{ variant_id: i.variant_id as string, sku: i.sku as string, solicitado: i.quantity as number, disponible: disp, motivo: 'stock_insuficiente' as const }]
        : [];
    });
    if (faltantes.length > 0) return { ok: false as const, estado: p.stock === 'none' ? ('none' as const) : ('released' as const), motivo: 'sin_stock' as const, faltantes };
    for (const i of p.items) this.vars.get(i.variant_id as string)!.disponible -= i.quantity as number;
    p.stock = 'reserved';
    return { ok: true as const, estado: 'reserved' as const };
  }

  async liberarStock(orderId: string) {
    this.marca('liberarStock');
    const p = this.pedidos.get(orderId)!;
    if (p.stock === 'reserved') {
      for (const i of p.items) this.vars.get(i.variant_id as string)!.disponible += i.quantity as number;
      p.stock = 'released';
    }
    return { ok: true as const, estado: p.stock === 'none' ? ('none' as const) : ('released' as const) };
  }

  async reservarCanje(orderId: string) {
    this.marca('reservarCanje');
    const p = this.pedidos.get(orderId)!;
    const codeId = p.fila.discount_code_id as string | null;
    if (!codeId) return { ok: true as const, estado: 'sin_codigo' as const };
    if (this.canjeRechazo) return { ok: false as const, estado: 'none' as const, motivo: this.canjeRechazo };
    const c = this.codigos.find((x) => x.id === codeId)!;
    c.usage_count += 1;
    p.canje = 'reserved';
    return { ok: true as const, estado: 'reserved' as const };
  }

  async liberarCanje(orderId: string) {
    this.marca('liberarCanje');
    const p = this.pedidos.get(orderId)!;
    if (p.canje === 'reserved') {
      const c = this.codigos.find((x) => x.id === p.fila.discount_code_id)!;
      c.usage_count -= 1;
      p.canje = 'released';
    }
    return { ok: true as const, estado: p.canje === 'none' ? ('sin_codigo' as const) : ('released' as const) };
  }

  async registrarEvento(orderId: string, evento: EventoPedido) {
    this.marca('registrarEvento');
    this.eventos.push({ orderId, evento });
  }

  async eliminarPedido(orderId: string) {
    this.marca('eliminarPedido');
    this.pedidos.delete(orderId);
    this.eliminados.push(orderId);
  }
}
