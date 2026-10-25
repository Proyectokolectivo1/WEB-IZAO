/**
 * Cálculo del dashboard (§21) a partir de los pedidos del periodo. Código puro: ninguna fórmula nueva, todo
 * sale de `@izao/core/metrics` (filas diarias, resumen por país, consolidado en COP). Aquí solo se agrupa para
 * las vistas (ciudades, productos, códigos, fuentes, panel de estados) y se arma el modelo de cada país.
 *
 * Mientras `daily_sales_stats` no tenga todas las columnas de §21.2 (ver bitácora), las filas diarias se
 * calculan en memoria con `filasVentasDiarias`, que es exactamente lo que escribirá el job nocturno.
 */
import {
  cuentaComoIngreso,
  esPagado,
  fechaAtribucion,
  filasVentasDiarias,
  ingresoConfirmado,
  razonBp,
  resumenPais,
  serieDiaria,
  variacionBp,
  diasEntre,
  type Bp,
  type FechaIso,
  type FilaVentasDiarias,
  type GarantiaMetrica,
  type GastoMetrica,
  type PedidoMetrica,
  type PuntoDiario,
  type RangoFechas,
  type ResumenPais,
  type TraficoMetrica,
} from '@izao/core/metrics';
import { currencyForCountry, type CountryCode, type CurrencyCode } from '@izao/core/money';

export type ItemMetrica = {
  productoId: string | null;
  sku: string;
  nombre: string;
  cantidad: number;
  precioUnitario: bigint;
  /** `null` si el producto no tenía costo cargado al venderse. */
  costoUnitario: bigint | null;
  /** Descuento prorrateado a la línea (total de la línea, no por unidad). */
  descuentoLinea: bigint;
};

export type GuiaMetrica = {
  /** Nombre del estado en MasterShop. */
  estado: string | null;
  /** Grupo del estado (`provider_status_parent`): Por preparar, En tránsito… */
  grupo: string | null;
  novedad: boolean;
};

export type PedidoDetalle = {
  pedido: PedidoMetrica;
  numero: string;
  ciudad: string | null;
  departamento: string | null;
  codigoId: string | null;
  influencerId: string | null;
  fuente: string;
  items: readonly ItemMetrica[];
  guia: GuiaMetrica | null;
};

export const SIN_DATO = 'Sin dato';

/** Fuente de venta a partir de UTM y click IDs (§21.3 punto 9). */
export function fuenteDeVenta(utm: unknown, clickIds: unknown): string {
  const texto = (o: unknown, ...claves: string[]): string => {
    if (!o || typeof o !== 'object') return '';
    for (const c of claves) {
      const v = (o as Record<string, unknown>)[c];
      if (typeof v === 'string' && v.trim() !== '') return v.trim().toLowerCase().slice(0, 40);
    }
    return '';
  };
  const origen = texto(utm, 'utm_source', 'source');
  const medio = texto(utm, 'utm_medium', 'medium');
  if (origen) return medio ? `${origen} / ${medio}` : origen;
  if (clickIds && typeof clickIds === 'object') {
    const c = clickIds as Record<string, unknown>;
    const tiene = (k: string) => typeof c[k] === 'string' && (c[k] as string) !== '';
    if (tiene('fbclid')) return 'meta (clic de anuncio)';
    if (tiene('gclid')) return 'google (clic de anuncio)';
    if (tiene('ttclid')) return 'tiktok (clic de anuncio)';
  }
  return 'Directo o sin fuente';
}

/** Filas de `daily_sales_stats` del conjunto de pedidos de un país, una tanda de 5 por día con pedidos. */
export function filasDePedidos(pedidos: readonly PedidoMetrica[], pais: CountryCode): { filas: FilaVentasDiarias[]; descartados: number } {
  const moneda = currencyForCountry(pais);
  const porDia = new Map<FechaIso, PedidoMetrica[]>();
  let descartados = 0;
  for (const original of pedidos) {
    if (original.pais !== pais || original.moneda !== moneda) {
      descartados += 1;
      continue;
    }
    // El método manual no tiene pasarela (el núcleo lo exige); un valor estimado viejo no debe romper el panel.
    const p = original.metodo === 'manual' && original.comisionPasarela !== 0n ? { ...original, comisionPasarela: 0n } : original;
    const dia = fechaAtribucion(p);
    const lista = porDia.get(dia);
    if (lista) lista.push(p);
    else porDia.set(dia, [p]);
  }
  const filas: FilaVentasDiarias[] = [];
  for (const dia of [...porDia.keys()].sort()) filas.push(...filasVentasDiarias(porDia.get(dia)!, dia, pais));
  return { filas, descartados };
}

// ---------------------------------------------------------------------------------------------------------
// Tops
// ---------------------------------------------------------------------------------------------------------

export type FilaCiudad = {
  clave: string;
  ciudad: string;
  departamento: string;
  pedidos: number;
  ventasBrutas: bigint;
  entregados: number;
  devueltos: number;
  devolucionBp: Bp | null;
};

export function topCiudades(detalles: readonly PedidoDetalle[], limite = 10): FilaCiudad[] {
  const mapa = new Map<string, FilaCiudad>();
  for (const d of detalles) {
    if (!esPagado(d.pedido.estado)) continue;
    const ciudad = d.ciudad ?? SIN_DATO;
    const departamento = d.departamento ?? SIN_DATO;
    const clave = `${ciudad}|${departamento}`;
    const f = mapa.get(clave) ?? { clave, ciudad, departamento, pedidos: 0, ventasBrutas: 0n, entregados: 0, devueltos: 0, devolucionBp: null };
    f.pedidos += 1;
    f.ventasBrutas += d.pedido.total;
    if (d.pedido.estado === 'entregado') f.entregados += 1;
    if (d.pedido.estado === 'devuelto') f.devueltos += 1;
    mapa.set(clave, f);
  }
  const filas = [...mapa.values()];
  for (const f of filas) f.devolucionBp = razonBp(BigInt(f.devueltos), BigInt(f.entregados + f.devueltos));
  return ordenarPorVentas(filas, limite);
}

export type FilaDepartamento = Omit<FilaCiudad, 'ciudad' | 'clave'>;

export function topDepartamentos(detalles: readonly PedidoDetalle[], limite = 10): FilaDepartamento[] {
  const mapa = new Map<string, FilaDepartamento>();
  for (const d of detalles) {
    if (!esPagado(d.pedido.estado)) continue;
    const departamento = d.departamento ?? SIN_DATO;
    const f = mapa.get(departamento) ?? { departamento, pedidos: 0, ventasBrutas: 0n, entregados: 0, devueltos: 0, devolucionBp: null };
    f.pedidos += 1;
    f.ventasBrutas += d.pedido.total;
    if (d.pedido.estado === 'entregado') f.entregados += 1;
    if (d.pedido.estado === 'devuelto') f.devueltos += 1;
    mapa.set(departamento, f);
  }
  const filas = [...mapa.values()];
  for (const f of filas) f.devolucionBp = razonBp(BigInt(f.devueltos), BigInt(f.entregados + f.devueltos));
  return ordenarPorVentas(filas, limite);
}

function ordenarPorVentas<T extends { ventasBrutas: bigint }>(filas: T[], limite: number): T[] {
  return filas.sort((a, b) => (a.ventasBrutas === b.ventasBrutas ? 0 : a.ventasBrutas > b.ventasBrutas ? -1 : 1)).slice(0, limite);
}

export type FilaProducto = {
  clave: string;
  nombre: string;
  unidades: number;
  ventas: bigint;
  costo: bigint;
  utilidad: bigint;
  /** Unidades vendidas sin costo cargado (la utilidad es mayor a la real). */
  unidadesSinCosto: number;
};

/**
 * Productos de pedidos pagados y no devueltos (la mercancía devuelta regresa al inventario). Ventas = precio ×
 * cantidad − descuento de la línea; utilidad = ventas − costo del producto.
 */
export function topProductos(detalles: readonly PedidoDetalle[], limite = 10): FilaProducto[] {
  const mapa = new Map<string, FilaProducto>();
  for (const d of detalles) {
    const e = d.pedido.estado;
    if (!esPagado(e) || e === 'devuelto') continue;
    for (const it of d.items) {
      const clave = it.productoId ?? `sku:${it.sku}`;
      const f = mapa.get(clave) ?? { clave, nombre: it.nombre, unidades: 0, ventas: 0n, costo: 0n, utilidad: 0n, unidadesSinCosto: 0 };
      const cantidad = BigInt(it.cantidad);
      f.unidades += it.cantidad;
      f.ventas += it.precioUnitario * cantidad - it.descuentoLinea;
      if (it.costoUnitario === null) f.unidadesSinCosto += it.cantidad;
      else f.costo += it.costoUnitario * cantidad;
      mapa.set(clave, f);
    }
  }
  const filas = [...mapa.values()];
  for (const f of filas) f.utilidad = f.ventas - f.costo;
  return filas.sort((a, b) => (a.ventas === b.ventas ? 0 : a.ventas > b.ventas ? -1 : 1)).slice(0, limite);
}

export type FilaAgrupada = {
  clave: string;
  pedidos: number;
  pagados: number;
  ventasBrutas: bigint;
  ingresosConfirmados: bigint;
};

function agrupar(detalles: readonly PedidoDetalle[], claveDe: (d: PedidoDetalle) => string | null, limite: number): FilaAgrupada[] {
  const mapa = new Map<string, FilaAgrupada>();
  for (const d of detalles) {
    const clave = claveDe(d);
    if (clave === null) continue;
    const f = mapa.get(clave) ?? { clave, pedidos: 0, pagados: 0, ventasBrutas: 0n, ingresosConfirmados: 0n };
    f.pedidos += 1;
    if (esPagado(d.pedido.estado)) {
      f.pagados += 1;
      f.ventasBrutas += d.pedido.total;
    }
    f.ingresosConfirmados += ingresoConfirmado(d.pedido);
    mapa.set(clave, f);
  }
  return ordenarPorVentas([...mapa.values()], limite);
}

export const topCodigos = (d: readonly PedidoDetalle[], limite = 10) => agrupar(d, (x) => x.codigoId, limite);
export const topInfluencers = (d: readonly PedidoDetalle[], limite = 10) => agrupar(d, (x) => x.influencerId, limite);
export const topFuentes = (d: readonly PedidoDetalle[], limite = 10) => agrupar(d, (x) => x.fuente, limite);

// ---------------------------------------------------------------------------------------------------------
// Panel por estado de guía (§21.3 punto 5)
// ---------------------------------------------------------------------------------------------------------

export type PanelGuias = {
  /** Conteo por estado del pedido (los estados sin pedidos no aparecen). */
  porEstadoPedido: Record<string, number>;
  /** Conteo por estado de MasterShop, con su grupo. */
  porEstadoGuia: { estado: string; grupo: string | null; cantidad: number }[];
  porGrupo: { grupo: string; cantidad: number }[];
  conNovedad: number;
  errorTransportadora: number;
  abonosPendientes: number;
  abandonados: number;
};

export function panelGuias(detalles: readonly PedidoDetalle[]): PanelGuias {
  const porEstadoPedido: Record<string, number> = {};
  const estados = new Map<string, { estado: string; grupo: string | null; cantidad: number }>();
  const grupos = new Map<string, number>();
  let conNovedad = 0;
  for (const d of detalles) {
    const e = d.pedido.estado;
    porEstadoPedido[e] = (porEstadoPedido[e] ?? 0) + 1;
    const g = d.guia;
    if (!g) continue;
    if (g.novedad) conNovedad += 1;
    if (g.estado) {
      const clave = `${g.grupo ?? ''}|${g.estado}`;
      const f = estados.get(clave) ?? { estado: g.estado, grupo: g.grupo, cantidad: 0 };
      f.cantidad += 1;
      estados.set(clave, f);
    }
    if (g.grupo) grupos.set(g.grupo, (grupos.get(g.grupo) ?? 0) + 1);
  }
  const porCantidad = <T extends { cantidad: number }>(a: T, b: T) => b.cantidad - a.cantidad;
  return {
    porEstadoPedido,
    porEstadoGuia: [...estados.values()].sort(porCantidad),
    porGrupo: [...grupos.entries()].map(([grupo, cantidad]) => ({ grupo, cantidad })).sort(porCantidad),
    conNovedad,
    errorTransportadora: porEstadoPedido.error_transportadora ?? 0,
    abonosPendientes: porEstadoPedido.esperando_abono ?? 0,
    abandonados: porEstadoPedido.abandonado ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Modelo de un país
// ---------------------------------------------------------------------------------------------------------

export type DatosPais = {
  pais: CountryCode;
  detalles: readonly PedidoDetalle[];
  trafico: readonly TraficoMetrica[];
  gastos: readonly GastoMetrica[];
  garantias: readonly GarantiaMetrica[];
};

export type ModeloPais = {
  pais: CountryCode;
  moneda: CurrencyCode;
  resumen: ResumenPais;
  filas: FilaVentasDiarias[];
  serie: PuntoDiario[];
  ciudades: FilaCiudad[];
  departamentos: FilaDepartamento[];
  productos: FilaProducto[];
  codigos: FilaAgrupada[];
  influencers: FilaAgrupada[];
  fuentes: FilaAgrupada[];
  guias: PanelGuias;
  descartados: number;
};

export function modeloPais(datos: DatosPais, rango: RangoFechas): ModeloPais {
  const { filas, descartados } = filasDePedidos(
    datos.detalles.map((d) => d.pedido),
    datos.pais,
  );
  const resumen = resumenPais({ pais: datos.pais, filas, trafico: datos.trafico, gastos: datos.gastos, garantias: datos.garantias });
  return {
    pais: datos.pais,
    moneda: currencyForCountry(datos.pais),
    resumen,
    filas,
    serie: serieDiaria(filas, diasEntre(rango)),
    ciudades: topCiudades(datos.detalles),
    departamentos: topDepartamentos(datos.detalles),
    productos: topProductos(datos.detalles),
    codigos: topCodigos(datos.detalles),
    influencers: topInfluencers(datos.detalles),
    fuentes: topFuentes(datos.detalles),
    guias: panelGuias(datos.detalles),
    descartados,
  };
}

/** Variación porcentual (puntos básicos) de un monto contra el periodo anterior; `null` si no hay base. */
export function variacion(actual: bigint | number, anterior: bigint | number): Bp | null {
  return variacionBp(BigInt(actual), BigInt(anterior));
}

/** ¿Este pedido suma al ingreso del periodo? (reexportado para el detalle de Excel) */
export const sumaIngreso = cuentaComoIngreso;
