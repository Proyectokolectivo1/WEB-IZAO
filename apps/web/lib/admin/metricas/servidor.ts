import 'server-only';
/**
 * Lecturas del dashboard (§21) con el cliente de servicio. Calcula desde `orders` (con sus líneas, envío y pagos
 * embebidos) mientras `daily_sales_stats` no tenga las columnas de §21.2; la agregación y las fórmulas viven en
 * `dashboard.ts` y en `@izao/core/metrics`. Las lecturas van paginadas de a 1 000 filas (tope de PostgREST).
 */
import {
  consolidarEnCop,
  inicioDiaBogotaUtc,
  periodoAnterior,
  sumarDias,
  type GarantiaMetrica,
  type GastoMetrica,
  type PresetFecha,
  type RangoFechas,
  type ResumenPais,
  type TraficoMetrica,
  ESTADOS_GARANTIA,
} from '@izao/core/metrics';
import { fromDbAmount, currencyForCountry, type CountryCode } from '@izao/core/money';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import {
  fuenteDeVenta,
  modeloPais,
  type GuiaMetrica,
  type ItemMetrica,
  type ModeloPais,
  type PedidoDetalle,
} from './dashboard';
import { COLUMNAS_PEDIDO_METRICA, aPedidoMetrica, type FilaPedidoMetrica } from './pedidos';

export const PAISES_DASHBOARD = ['CO', 'EC'] as const;
export type PaisDashboard = CountryCode | 'TODOS';

const PAGINA = 1000;
/** Tope de seguridad por consulta (50 páginas): si se alcanza, el panel avisa que el resultado es parcial. */
const MAX_PAGINAS = 50;

const COLUMNAS_COMPLETAS = `${COLUMNAS_PEDIDO_METRICA}, number, shipping_city_name, shipping_region_name, discount_code_id, utm, click_ids, order_items(product_id, sku, name_snapshot, quantity, unit_price, unit_cost, line_discount), shipments(provider_status_name, provider_status_parent, has_novelty, shipping_rate), payments(order_id, status, fee_amount)`;
/** Para el periodo anterior (solo KPIs): sin líneas de pedido. */
const COLUMNAS_LIGERAS = `${COLUMNAS_PEDIDO_METRICA}, number, shipments(shipping_rate), payments(order_id, status, fee_amount)`;

type Monto = number | string | bigint;
type FilaCompleta = FilaPedidoMetrica & {
  number: string;
  shipping_city_name: string | null;
  shipping_region_name: string | null;
  discount_code_id: string | null;
  utm: unknown;
  click_ids: unknown;
  order_items?: {
    product_id: string | null;
    sku: string;
    name_snapshot: string;
    quantity: number;
    unit_price: Monto;
    unit_cost: Monto | null;
    line_discount: Monto;
  }[];
  shipments?: ShipmentEmbebido[] | ShipmentEmbebido | null;
  payments?: { order_id: string; status: string; fee_amount: Monto | null }[];
};
type ShipmentEmbebido = {
  provider_status_name?: string | null;
  provider_status_parent?: string | null;
  has_novelty?: boolean;
  shipping_rate: Monto | null;
};

type RespuestaPagina = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Lee todas las páginas de una consulta; `truncado` si se llegó al tope. */
async function leerPaginado<T>(pagina: (desde: number, hasta: number) => RespuestaPagina, que: string): Promise<{ filas: T[]; truncado: boolean }> {
  const filas: T[] = [];
  for (let n = 0; n < MAX_PAGINAS; n += 1) {
    const { data, error } = await pagina(n * PAGINA, n * PAGINA + PAGINA - 1);
    if (error) throw new Error(`No se pudo leer ${que}: ${error.message}`);
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    if (lote.length < PAGINA) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

const unico = <T>(v: T[] | T | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function aDetalle(f: FilaCompleta, estimadoPais: Monto): PedidoDetalle | null {
  const envio = unico(f.shipments);
  const pagos = (f.payments ?? []).filter((p) => p.status === 'approved');
  const pedido = aPedidoMetrica(f, { pagos, tarifaEnvio: envio?.shipping_rate ?? null, envioEstimadoPais: estimadoPais });
  if (!pedido) return null;
  const items: ItemMetrica[] = (f.order_items ?? []).map((i) => ({
    productoId: i.product_id,
    sku: i.sku,
    nombre: i.name_snapshot,
    cantidad: i.quantity,
    precioUnitario: fromDbAmount(i.unit_price),
    costoUnitario: i.unit_cost === null ? null : fromDbAmount(i.unit_cost),
    descuentoLinea: fromDbAmount(i.line_discount),
  }));
  const guia: GuiaMetrica | null = envio
    ? { estado: envio.provider_status_name ?? null, grupo: envio.provider_status_parent ?? null, novedad: envio.has_novelty === true }
    : null;
  return {
    pedido,
    numero: f.number,
    ciudad: f.shipping_city_name,
    departamento: f.shipping_region_name,
    codigoId: f.discount_code_id,
    influencerId: f.influencer_id ?? null,
    fuente: fuenteDeVenta(f.utm, f.click_ids),
    items,
    guia,
  };
}

/** Marcas de tiempo UTC del inicio del primer día y del día siguiente al último (días de Bogotá). */
function limitesUtc(r: RangoFechas): { ini: string; fin: string } {
  return { ini: inicioDiaBogotaUtc(r.desde).toISOString(), fin: inicioDiaBogotaUtc(sumarDias(r.hasta, 1)).toISOString() };
}

export type DatosCargados = {
  detalles: PedidoDetalle[];
  trafico: TraficoMetrica[];
  gastos: GastoMetrica[];
  garantias: GarantiaMetrica[];
  descartados: number;
  truncado: boolean;
};

/** Pedidos, tráfico, gastos y garantías de un país en `rango` (atribución de §21.1). */
export async function cargarDatosPais(
  cliente: Cliente,
  pais: CountryCode,
  rango: RangoFechas,
  opciones: { completo: boolean; estimadoPais: Monto },
): Promise<DatosCargados> {
  const { ini, fin } = limitesUtc(rango);
  const columnas = opciones.completo ? COLUMNAS_COMPLETAS : COLUMNAS_LIGERAS;
  const base = () => cliente.from('orders').select(columnas).eq('country_code', pais);
  const [pagados, sinPagar, trafico, gastos, garantias] = await Promise.all([
    leerPaginado<FilaCompleta>(
      (a, b) => base().gte('paid_at', ini).lt('paid_at', fin).order('id', { ascending: true }).range(a, b),
      'los pedidos pagados',
    ),
    leerPaginado<FilaCompleta>(
      (a, b) => base().is('paid_at', null).gte('created_at', ini).lt('created_at', fin).order('id', { ascending: true }).range(a, b),
      'los pedidos sin pagar',
    ),
    leerPaginado<{ date: string; sessions: Monto; product_views: Monto; add_to_cart: Monto; checkout_started: Monto }>(
      (a, b) =>
        cliente
          .from('daily_traffic_stats')
          .select('date, sessions, product_views, add_to_cart, checkout_started')
          .eq('country_code', pais)
          .gte('date', rango.desde)
          .lte('date', rango.hasta)
          .order('date', { ascending: true })
          .range(a, b),
      'el tráfico',
    ),
    leerPaginado<{ date: string; amount: Monto; currency_code: string; expense_categories: { slug: string } | { slug: string }[] | null }>(
      (a, b) =>
        cliente
          .from('expenses')
          .select('date, amount, currency_code, expense_categories(slug)')
          .eq('country_code', pais)
          .gte('date', rango.desde)
          .lte('date', rango.hasta)
          .order('date', { ascending: true })
          .range(a, b),
      'los gastos',
    ),
    leerPaginado<{ status: string; cost_amount: Monto }>(
      (a, b) =>
        cliente
          .from('warranty_claims')
          .select('status, cost_amount')
          .eq('country_code', pais)
          .gte('created_at', ini)
          .lt('created_at', fin)
          .order('created_at', { ascending: true })
          .range(a, b),
      'las garantías',
    ),
  ]);

  const detalles: PedidoDetalle[] = [];
  let descartados = 0;
  // Un pedido que cambia mientras se pagina podría llegar dos veces: se cuenta una sola.
  const unicas = new Map<string, FilaCompleta>();
  for (const fila of [...pagados.filas, ...sinPagar.filas]) unicas.set(fila.id, fila);
  for (const fila of unicas.values()) {
    const d = aDetalle(fila, opciones.estimadoPais);
    if (d) detalles.push(d);
    else descartados += 1;
  }
  const moneda = currencyForCountry(pais);
  const estadosGarantia: readonly string[] = ESTADOS_GARANTIA;
  return {
    detalles,
    trafico: trafico.filas.map((t) => ({
      fecha: t.date,
      pais,
      sesiones: fromDbAmount(t.sessions),
      vistasProducto: fromDbAmount(t.product_views),
      carrito: fromDbAmount(t.add_to_cart),
      checkouts: fromDbAmount(t.checkout_started),
    })),
    gastos: gastos.filas
      .filter((g) => g.currency_code === moneda)
      .map((g) => ({
        fecha: g.date,
        pais,
        moneda,
        categoria: unico(g.expense_categories)?.slug ?? 'sin_categoria',
        monto: fromDbAmount(g.amount),
      })),
    garantias: garantias.filas
      .filter((g) => estadosGarantia.includes(g.status))
      .map((g) => ({ pais, estado: g.status as GarantiaMetrica['estado'], costo: fromDbAmount(g.cost_amount) })),
    descartados,
    truncado: pagados.truncado || sinPagar.truncado || trafico.truncado || gastos.truncado || garantias.truncado,
  };
}

export type PaisVista = {
  actual: ModeloPais;
  anterior: ModeloPais;
  /** Pedidos del periodo (solo servidor): alimentan la hoja "Pedidos" del Excel. */
  detalles: readonly PedidoDetalle[];
};

export type VistaDashboard = {
  pais: PaisDashboard;
  rango: RangoFechas;
  anterior: RangoFechas;
  paises: PaisVista[];
  /** Solo con "Todos": cada moneda por separado más este consolidado en COP. */
  consolidado: { actual: ResumenPais; anterior: ResumenPais } | { error: 'sin_tasa'; pais: CountryCode } | null;
  /** Etiquetas de códigos e influencers que aparecen en los tops. */
  nombres: { codigos: Record<string, string>; influencers: Record<string, string> };
  truncado: boolean;
};

type Ajustes = Record<CountryCode, { estimado: Monto; tasa: unknown }>;

async function leerAjustes(cliente: Cliente): Promise<Ajustes> {
  const { data, error } = await cliente.from('country_settings').select('country_code, shipping_cost_estimate, fx_rate_to_cop');
  if (error) throw new Error(`No se pudieron leer los ajustes de país: ${error.message}`);
  const salida: Ajustes = { CO: { estimado: 0, tasa: null }, EC: { estimado: 0, tasa: null } };
  for (const f of (data ?? []) as { country_code: CountryCode; shipping_cost_estimate: Monto | null; fx_rate_to_cop: unknown }[]) {
    if (f.country_code in salida) salida[f.country_code] = { estimado: f.shipping_cost_estimate ?? 0, tasa: f.fx_rate_to_cop };
  }
  return salida;
}

async function etiquetas(cliente: Cliente, modelos: readonly ModeloPais[]) {
  const ids = (campo: 'codigos' | 'influencers') => [...new Set(modelos.flatMap((m) => m[campo].map((f) => f.clave)))];
  const [codigos, influencers] = await Promise.all([
    ids('codigos').length ? cliente.from('discount_codes').select('id, code').in('id', ids('codigos')) : { data: [] },
    ids('influencers').length ? cliente.from('influencers').select('id, name').in('id', ids('influencers')) : { data: [] },
  ]);
  return {
    codigos: Object.fromEntries(((codigos.data ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code])),
    influencers: Object.fromEntries(((influencers.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name])),
  };
}

/** Dashboard completo del periodo y del periodo anterior equivalente (§21.1). */
export async function cargarDashboard(
  cliente: Cliente,
  f: { pais: PaisDashboard; rango: RangoFechas; preset: PresetFecha | null },
): Promise<VistaDashboard> {
  const anterior = periodoAnterior(f.rango, f.preset ?? undefined);
  const ajustes = await leerAjustes(cliente);
  const paises: readonly CountryCode[] = f.pais === 'TODOS' ? PAISES_DASHBOARD : [f.pais];
  let truncado = false;
  const vistas: PaisVista[] = await Promise.all(
    paises.map(async (pais) => {
      const estimadoPais = ajustes[pais].estimado;
      const [a, p] = await Promise.all([
        cargarDatosPais(cliente, pais, f.rango, { completo: true, estimadoPais }),
        cargarDatosPais(cliente, pais, anterior, { completo: false, estimadoPais }),
      ]);
      if (a.truncado || p.truncado) truncado = true;
      return {
        actual: modeloPais({ pais, ...a }, f.rango),
        anterior: modeloPais({ pais, ...p }, anterior),
        detalles: a.detalles,
      };
    }),
  );

  let consolidado: VistaDashboard['consolidado'] = null;
  if (f.pais === 'TODOS') {
    const tasas = { CO: ajustes.CO.tasa, EC: ajustes.EC.tasa };
    const act = consolidarEnCop(vistas.map((v) => v.actual.resumen), tasas);
    const ant = consolidarEnCop(vistas.map((v) => v.anterior.resumen), tasas);
    consolidado = 'error' in act ? act : 'error' in ant ? ant : { actual: act, anterior: ant };
  }
  return {
    pais: f.pais,
    rango: f.rango,
    anterior,
    paises: vistas,
    consolidado,
    nombres: await etiquetas(cliente, vistas.map((v) => v.actual)),
    truncado,
  };
}
