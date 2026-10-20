/**
 * Fuente del checkout en memoria, solo para pruebas. Imita `crear_pedido_checkout` de la base: stock, canje
 * y clave única de idempotencia en una sola transacción (todo o nada).
 */
import type { CountryCode } from '@izao/core/money';
import type { PricingDiscountCode } from '@izao/core/pricing';
import type { OrderStatus } from '@izao/core/order-state';
import type {
  ConfigPais,
  FilaItem,
  FilaPedido,
  FuenteCheckout,
  PedidoCreado,
  ResultadoCrearPedido,
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
  readonly eventos: {
    orderId: string;
    evento: { type: string; from_status: OrderStatus | null; to_status: OrderStatus; actor: 'system' };
  }[] = [];
  /** Simula otra petición con la misma clave a mitad de la transacción (`en_proceso`). */
  enProceso = false;
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


  /** Imita `crear_pedido_checkout`: idempotencia, restricciones de la tabla, stock y canje; todo o nada. */
  async crearPedido(fila: FilaPedido, items: readonly FilaItem[]): Promise<ResultadoCrearPedido> {
    this.marca('crearPedido');
    for (const p of this.pedidos.values()) {
      if (p.fila.checkout_idempotency_key !== fila.checkout_idempotency_key) continue;
      if (p.fila.country_code !== fila.country_code) return { ok: false, motivo: 'idempotencia_conflicto' };
      return { ok: true, repetido: true, pedido: this.resumen(p) };
    }
    if (this.enProceso) return { ok: false, motivo: 'en_proceso' };
    if (items.length === 0) return { ok: false, motivo: 'sin_items' };
    const pais = fila.country_code as CountryCode;
    const n = this.secuencia + 1;
    const pedido: Omit<PedidoCreado, 'lines'> = {
      id: ID_PEDIDO(n),
      number: `IZ-${pais}-${String(n).padStart(6, '0')}`,
      public_token: `tok${n}`,
      // La base fija el estado inicial por método; aquí se respeta el de la fila (mismo mapa).
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
    if (pedido.total_customer !== pedido.subtotal - pedido.discount + pedido.surcharge) {
      return { ok: false, motivo: 'datos_invalidos' };
    }
    if (pedido.payment_method === 'cod' && pedido.cod_collect !== pedido.total_customer - pedido.cod_deposit) {
      return { ok: false, motivo: 'datos_invalidos' };
    }
    const faltantes = items.flatMap((i) => {
      const disp = this.vars.get(i.variant_id as string)?.disponible ?? 0;
      return disp < (i.quantity as number)
        ? [{ variant_id: i.variant_id as string, solicitado: i.quantity as number, disponible: disp }]
        : [];
    });
    if (faltantes.length > 0) return { ok: false, motivo: 'sin_stock', faltantes };
    const codeId = fila.discount_code_id as string | null;
    if (codeId && this.canjeRechazo) return { ok: false, motivo: this.canjeRechazo };

    // Todo validado: se escribe de una vez.
    this.secuencia = n;
    for (const i of items) this.vars.get(i.variant_id as string)!.disponible -= i.quantity as number;
    if (codeId) this.codigos.find((x) => x.id === codeId)!.usage_count += 1;
    const guardado: PedidoGuardado = {
      fila,
      pedido,
      items: [...items],
      stock: 'reserved',
      canje: codeId ? 'reserved' : 'none',
    };
    this.pedidos.set(pedido.id, guardado);
    this.eventos.push({
      orderId: pedido.id,
      evento: { type: 'created', from_status: null, to_status: pedido.status, actor: 'system' },
    });
    return { ok: true, repetido: false, pedido: this.resumen(guardado) };
  }
}
