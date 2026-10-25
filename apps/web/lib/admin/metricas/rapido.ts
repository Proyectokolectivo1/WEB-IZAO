/**
 * Camino rápido del dashboard (§21.4): los KPIs y la serie salen de `daily_sales_stats` y los tops y el panel de guías de
 * las RPC `metricas_*` de la base. Nunca se recorre `orders`. Código puro: convierte las filas de la base a los tipos del
 * núcleo y arma el mismo `ModeloPais` que el cálculo desde pedidos (que queda para el Excel, que sí necesita el detalle).
 */
import {
  diasEntre,
  razonBp,
  resumenPais,
  serieDiaria,
  type FilaVentasDiarias,
  type GarantiaMetrica,
  type GastoMetrica,
  type MetodoPago,
  type RangoFechas,
  type TraficoMetrica,
} from '@izao/core/metrics';
import { currencyForCountry, fromDbAmount, type CountryCode } from '@izao/core/money';
import type {
  FilaAgrupada,
  FilaCiudad,
  FilaDepartamento,
  FilaProducto,
  ModeloPais,
  PanelGuias,
} from './dashboard';
import { SIN_DATO } from './dashboard';

type Monto = number | string | bigint;

/** Fila de `daily_sales_stats` tal como la entrega PostgREST. */
export type FilaStatsBd = {
  date: string;
  country_code: CountryCode;
  payment_method: MetodoPago;
  currency_code: 'COP' | 'USD';
  orders_created: number;
  orders_paid: number;
  orders_abandoned: number;
  gross_sales: Monto;
  discounts: Monto;
  surcharges: Monto;
  cod_deposits: Monto;
  cod_collect_sent: Monto;
  prepaid_sent_value: Monto;
  delivered_count: number;
  delivered_value: Monto;
  returned_count: number;
  returned_value: Monto;
  cod_deposits_returned: Monto;
  confirmed_revenue: Monto;
  gateway_fees: Monto;
  carrier_platform_fees: Monto;
  product_cost: Monto;
  shipping_cost: Monto;
  shipping_estimated_count: number;
  warranty_cost: Monto;
};

export const COLUMNAS_STATS =
  'date, country_code, payment_method, currency_code, orders_created, orders_paid, orders_abandoned, gross_sales, discounts, surcharges, cod_deposits, cod_collect_sent, prepaid_sent_value, delivered_count, delivered_value, returned_count, returned_value, cod_deposits_returned, confirmed_revenue, gateway_fees, carrier_platform_fees, product_cost, shipping_cost, shipping_estimated_count, warranty_cost';

export function aFilaVentas(f: FilaStatsBd): FilaVentasDiarias {
  const b = (v: Monto) => fromDbAmount(v);
  return {
    date: f.date,
    country_code: f.country_code,
    payment_method: f.payment_method,
    currency_code: f.currency_code,
    orders_created: f.orders_created,
    orders_paid: f.orders_paid,
    orders_abandoned: f.orders_abandoned,
    gross_sales: b(f.gross_sales),
    discounts: b(f.discounts),
    surcharges: b(f.surcharges),
    cod_deposits: b(f.cod_deposits),
    cod_collect_sent: b(f.cod_collect_sent),
    prepaid_sent_value: b(f.prepaid_sent_value),
    delivered_count: f.delivered_count,
    delivered_value: b(f.delivered_value),
    returned_count: f.returned_count,
    returned_value: b(f.returned_value),
    cod_deposits_returned: b(f.cod_deposits_returned),
    confirmed_revenue: b(f.confirmed_revenue),
    gateway_fees: b(f.gateway_fees),
    carrier_platform_fees: b(f.carrier_platform_fees),
    product_cost: b(f.product_cost),
    shipping_cost: b(f.shipping_cost),
    shipping_estimated_count: f.shipping_estimated_count,
    warranty_cost: b(f.warranty_cost),
  };
}

// ── Filas de las RPC ─────────────────────────────────────────────────────────────────────────────

export type RpcCiudad = { ciudad: string | null; departamento: string | null; pedidos: number; ventas_brutas: Monto; entregados: number; devueltos: number };
export type RpcDepartamento = { departamento: string | null; pedidos: number; ventas_brutas: Monto; entregados: number; devueltos: number };
export type RpcProducto = { producto_id: string | null; sku: string | null; nombre: string | null; unidades: number; ventas: Monto; costo: Monto; utilidad: Monto; unidades_sin_costo: number };
export type RpcAgrupado = { clave: string; etiqueta: string | null; pedidos: number; pagados: number; ventas_brutas: Monto; ingresos_confirmados: Monto };
export type RpcGuia = { dimension: string; estado: string | null; grupo: string | null; cantidad: number };

export type TopsPais = {
  ciudades: FilaCiudad[];
  departamentos: FilaDepartamento[];
  productos: FilaProducto[];
  codigos: FilaAgrupada[];
  influencers: FilaAgrupada[];
  fuentes: FilaAgrupada[];
  guias: PanelGuias;
  /** Etiquetas legibles de códigos e influencers, por clave. */
  etiquetas: { codigos: Record<string, string>; influencers: Record<string, string> };
};

export function aCiudades(filas: readonly RpcCiudad[]): FilaCiudad[] {
  return filas.map((c) => {
    const ciudad = c.ciudad ?? SIN_DATO;
    const departamento = c.departamento ?? SIN_DATO;
    return {
      clave: `${ciudad}|${departamento}`,
      ciudad,
      departamento,
      pedidos: c.pedidos,
      ventasBrutas: fromDbAmount(c.ventas_brutas),
      entregados: c.entregados,
      devueltos: c.devueltos,
      devolucionBp: razonBp(BigInt(c.devueltos), BigInt(c.entregados + c.devueltos)),
    };
  });
}

export function aDepartamentos(filas: readonly RpcDepartamento[]): FilaDepartamento[] {
  return filas.map((c) => ({
    departamento: c.departamento ?? SIN_DATO,
    pedidos: c.pedidos,
    ventasBrutas: fromDbAmount(c.ventas_brutas),
    entregados: c.entregados,
    devueltos: c.devueltos,
    devolucionBp: razonBp(BigInt(c.devueltos), BigInt(c.entregados + c.devueltos)),
  }));
}

export function aProductos(filas: readonly RpcProducto[]): FilaProducto[] {
  return filas.map((p) => ({
    clave: p.producto_id ?? `sku:${p.sku ?? ''}`,
    nombre: p.nombre ?? p.sku ?? SIN_DATO,
    unidades: p.unidades,
    ventas: fromDbAmount(p.ventas),
    costo: fromDbAmount(p.costo),
    utilidad: fromDbAmount(p.utilidad),
    unidadesSinCosto: p.unidades_sin_costo,
  }));
}

export function aAgrupados(filas: readonly RpcAgrupado[]): FilaAgrupada[] {
  return filas.map((a) => ({
    clave: a.clave,
    pedidos: a.pedidos,
    pagados: a.pagados,
    ventasBrutas: fromDbAmount(a.ventas_brutas),
    ingresosConfirmados: fromDbAmount(a.ingresos_confirmados),
  }));
}

/** Etiquetas por clave (código escrito, nombre del influencer); la clave `texto:CODIGO` de un código borrado se muestra como el texto. */
export function etiquetasDe(filas: readonly RpcAgrupado[]): Record<string, string> {
  return Object.fromEntries(filas.map((a) => [a.clave, a.etiqueta ?? (a.clave.startsWith('texto:') ? a.clave.slice(6) : '(eliminado)')]));
}

export function aPanelGuias(filas: readonly RpcGuia[]): PanelGuias {
  const porEstadoPedido: Record<string, number> = {};
  const porEstadoGuia: PanelGuias['porEstadoGuia'] = [];
  const porGrupo: PanelGuias['porGrupo'] = [];
  let conNovedad = 0;
  for (const f of filas) {
    if (f.dimension === 'estado_pedido' && f.estado) porEstadoPedido[f.estado] = f.cantidad;
    else if (f.dimension === 'estado_guia' && f.estado) porEstadoGuia.push({ estado: f.estado, grupo: f.grupo, cantidad: f.cantidad });
    else if (f.dimension === 'grupo_guia' && f.grupo) porGrupo.push({ grupo: f.grupo, cantidad: f.cantidad });
    else if (f.dimension === 'novedad') conNovedad = f.cantidad;
  }
  const mayor = <T extends { cantidad: number }>(a: T, b: T) => b.cantidad - a.cantidad;
  return {
    porEstadoPedido,
    porEstadoGuia: porEstadoGuia.sort(mayor),
    porGrupo: porGrupo.sort(mayor),
    conNovedad,
    errorTransportadora: porEstadoPedido.error_transportadora ?? 0,
    abonosPendientes: porEstadoPedido.esperando_abono ?? 0,
    abandonados: porEstadoPedido.abandonado ?? 0,
  };
}

/** Pedidos creados que ve el panel de guías (todos los del periodo): sirve para contrastar con las estadísticas diarias. */
export function totalPanel(g: PanelGuias): number {
  return Object.values(g.porEstadoPedido).reduce((a, n) => a + n, 0);
}

export function topsVacios(): TopsPais {
  return {
    ciudades: [],
    departamentos: [],
    productos: [],
    codigos: [],
    influencers: [],
    fuentes: [],
    guias: aPanelGuias([]),
    etiquetas: { codigos: {}, influencers: {} },
  };
}

// ── Modelo ───────────────────────────────────────────────────────────────────────────────────────

export type DatosRapidos = {
  pais: CountryCode;
  filas: readonly FilaVentasDiarias[];
  trafico: readonly TraficoMetrica[];
  gastos: readonly GastoMetrica[];
  garantias: readonly GarantiaMetrica[];
  tops: TopsPais;
};

/** Mismo `ModeloPais` que `modeloPais` (desde pedidos), pero a partir de las estadísticas diarias y los tops ya agregados. */
export function modeloPaisRapido(d: DatosRapidos, rango: RangoFechas): ModeloPais {
  return {
    pais: d.pais,
    moneda: currencyForCountry(d.pais),
    resumen: resumenPais({ pais: d.pais, filas: d.filas, trafico: d.trafico, gastos: d.gastos, garantias: d.garantias }),
    filas: [...d.filas],
    serie: serieDiaria(d.filas, diasEntre(rango)),
    ciudades: d.tops.ciudades,
    departamentos: d.tops.departamentos,
    productos: d.tops.productos,
    codigos: d.tops.codigos,
    influencers: d.tops.influencers,
    fuentes: d.tops.fuentes,
    guias: d.tops.guias,
    descartados: 0,
  };
}
