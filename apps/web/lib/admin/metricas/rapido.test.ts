import { describe, expect, it, vi } from 'vitest';
import type { MetodoPago } from '@izao/core/metrics';
import type { Cliente } from '../catalogo/taxonomias-servidor';
import { conCache, deserializar, serializar, type AlmacenCache } from './cache';
import { aAgrupados, aCiudades, aFilaVentas, aPanelGuias, aProductos, etiquetasDe, totalPanel, type FilaStatsBd } from './rapido';
import { cargarDashboard } from './servidor';

const stats = (date: string, metodo: MetodoPago, o: Partial<FilaStatsBd> = {}): FilaStatsBd => ({
  date,
  country_code: 'CO',
  payment_method: metodo,
  currency_code: 'COP',
  orders_created: 0,
  orders_paid: 0,
  orders_abandoned: 0,
  gross_sales: 0,
  discounts: 0,
  surcharges: 0,
  cod_deposits: 0,
  cod_collect_sent: 0,
  prepaid_sent_value: 0,
  delivered_count: 0,
  delivered_value: 0,
  returned_count: 0,
  returned_value: 0,
  cod_deposits_returned: 0,
  confirmed_revenue: 0,
  gateway_fees: 0,
  carrier_platform_fees: 0,
  product_cost: 0,
  shipping_cost: 0,
  shipping_estimated_count: 0,
  warranty_cost: 0,
  ...o,
});

describe('conversión de filas de la base', () => {
  it('las estadísticas diarias pasan a bigint', () => {
    const f = aFilaVentas(stats('2026-11-02', 'wompi', { gross_sales: '100000', confirmed_revenue: 100000, orders_paid: 1 }));
    expect(f.gross_sales).toBe(100000n);
    expect(f.confirmed_revenue).toBe(100000n);
    expect(f.orders_paid).toBe(1);
  });

  it('ciudades, productos y agrupados: montos exactos, textos vacíos con valor por defecto, % devolución', () => {
    const c = aCiudades([{ ciudad: null, departamento: 'Antioquia', pedidos: 3, ventas_brutas: '300000', entregados: 1, devueltos: 1 }]);
    expect(c[0]).toMatchObject({ ciudad: 'Sin dato', departamento: 'Antioquia', ventasBrutas: 300000n, devolucionBp: 5000n });
    const p = aProductos([{ producto_id: null, sku: 'A1', nombre: null, unidades: 2, ventas: 90000, costo: 40000, utilidad: 50000, unidades_sin_costo: 0 }]);
    expect(p[0]).toMatchObject({ clave: 'sku:A1', nombre: 'A1', utilidad: 50000n });
    const a = aAgrupados([{ clave: 'texto:VERANO', etiqueta: 'VERANO', pedidos: 2, pagados: 1, ventas_brutas: 1000, ingresos_confirmados: 900 }]);
    expect(a[0]).toMatchObject({ clave: 'texto:VERANO', ventasBrutas: 1000n, ingresosConfirmados: 900n });
  });

  it('las etiquetas de un código borrado salen del texto de la clave', () => {
    expect(etiquetasDe([{ clave: 'c1', etiqueta: 'IZAO10', pedidos: 1, pagados: 1, ventas_brutas: 0, ingresos_confirmados: 0 }, { clave: 'texto:OLD', etiqueta: null, pedidos: 1, pagados: 0, ventas_brutas: 0, ingresos_confirmados: 0 }, { clave: 'i9', etiqueta: null, pedidos: 1, pagados: 0, ventas_brutas: 0, ingresos_confirmados: 0 }])).toEqual({
      c1: 'IZAO10',
      'texto:OLD': 'OLD',
      i9: '(eliminado)',
    });
  });

  it('el panel de guías arma estados, grupos y novedad', () => {
    const g = aPanelGuias([
      { dimension: 'estado_pedido', estado: 'entregado', grupo: null, cantidad: 5 },
      { dimension: 'estado_pedido', estado: 'error_transportadora', grupo: null, cantidad: 2 },
      { dimension: 'estado_pedido', estado: 'esperando_abono', grupo: null, cantidad: 1 },
      { dimension: 'estado_guia', estado: 'En reparto', grupo: 'En tránsito', cantidad: 3 },
      { dimension: 'estado_guia', estado: 'Entregado', grupo: 'Finalizadas', cantidad: 5 },
      { dimension: 'grupo_guia', estado: null, grupo: 'Finalizadas', cantidad: 5 },
      { dimension: 'novedad', estado: null, grupo: null, cantidad: 4 },
    ]);
    expect(g).toMatchObject({ conNovedad: 4, errorTransportadora: 2, abonosPendientes: 1 });
    expect(g.porEstadoGuia[0]).toEqual({ estado: 'Entregado', grupo: 'Finalizadas', cantidad: 5 });
    expect(totalPanel(g)).toBe(8);
  });
});

describe('caché de 5 minutos', () => {
  it('serializa bigint sin pasar por number', () => {
    const v = { monto: 9_007_199_254_740_993n, lista: [1n, { x: 2n }], texto: 'a' };
    expect(deserializar<typeof v>(serializar(v))).toEqual(v);
  });

  const almacen = (inicial: string | null = null) => {
    const guardado = new Map<string, string>(inicial === null ? [] : [['k', inicial]]);
    const set = vi.fn(async (k: string, v: string) => void guardado.set(k, v));
    return { guardado, set, a: { get: async (k: string) => guardado.get(k) ?? null, set } as AlmacenCache };
  };

  it('calcula una vez, guarda con 5 minutos de vida y la segunda vez no calcula', async () => {
    const { a, set } = almacen();
    const calcular = vi.fn(async () => ({ total: 5n }));
    const uno = await conCache('k', calcular, { almacen: a });
    const dos = await conCache('k', calcular, { almacen: a });
    expect(uno).toEqual({ valor: { total: 5n }, desdeCache: false });
    expect(dos).toEqual({ valor: { total: 5n }, desdeCache: true });
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('k', expect.any(String), 'EX', 300);
  });

  it('si Redis falla o no existe, calcula directo y no lanza', async () => {
    const roto: AlmacenCache = { get: async () => { throw new Error('ECONNREFUSED'); }, set: async () => { throw new Error('ECONNREFUSED'); } };
    expect((await conCache('k', async () => 7, { almacen: roto })).valor).toBe(7);
    expect((await conCache('k', async () => 8, { almacen: null })).valor).toBe(8);
  });
});

// ── Dashboard rápido: sin tocar orders, con datos de 12 meses simulados ─────────────────────────

const METODOS: MetodoPago[] = ['wompi', 'addi', 'sistecredito', 'cod', 'manual'];

function dias(desde: string, hasta: string): string[] {
  const salida: string[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86_400_000) salida.push(new Date(t).toISOString().slice(0, 10));
  return salida;
}

/** Cliente mínimo con la paginación y los filtros de fecha que usa el dashboard, y llamadas registradas. */
function clienteSimulado(filasStats: FilaStatsBd[]) {
  const tablas: string[] = [];
  const rpcs: string[] = [];
  const cliente = {
    from(tabla: string) {
      tablas.push(tabla);
      let desde = '';
      let hasta = '';
      let pais = '';
      let rango: [number, number] = [0, 999];
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'not', 'order', 'lt', 'in']) b[m] = () => b;
      b.eq = (c: string, v: string) => ((c === 'country_code' ? (pais = v) : null), b);
      b.gte = (c: string, v: string) => ((c === 'date' ? (desde = v) : null), b);
      b.lte = (c: string, v: string) => ((c === 'date' ? (hasta = v) : null), b);
      b.range = (a: number, z: number) => ((rango = [a, z]), b);
      b.maybeSingle = async () => ({ data: null, error: null });
      b.then = (ok: (v: unknown) => unknown) => {
        let data: unknown[] = [];
        if (tabla === 'daily_sales_stats') data = filasStats.filter((f) => f.country_code === pais && f.date >= desde && f.date <= hasta).slice(rango[0], rango[1] + 1);
        if (tabla === 'country_settings') data = [{ country_code: 'CO', shipping_cost_estimate: 0, fx_rate_to_cop: 1 }, { country_code: 'EC', shipping_cost_estimate: 0, fx_rate_to_cop: 4000 }];
        return Promise.resolve({ data, error: null, count: null }).then(ok);
      };
      return b;
    },
    async rpc(nombre: string) {
      rpcs.push(nombre);
      const filas: Record<string, unknown[]> = {
        metricas_top_ciudades: [{ ciudad: 'Medellín', departamento: 'Antioquia', pedidos: 500, ventas_brutas: 90_000_000, entregados: 400, devueltos: 20 }],
        metricas_top_departamentos: [{ departamento: 'Antioquia', pedidos: 500, ventas_brutas: 90_000_000, entregados: 400, devueltos: 20 }],
        metricas_top_productos: [{ producto_id: 'p1', sku: 'A', nombre: 'Perfume A', unidades: 900, ventas: 80_000_000, costo: 30_000_000, utilidad: 50_000_000, unidades_sin_costo: 0 }],
        metricas_top_agrupado: [{ clave: 'c1', etiqueta: 'IZAO10', pedidos: 80, pagados: 70, ventas_brutas: 9_000_000, ingresos_confirmados: 8_000_000 }],
        metricas_panel_guias: [{ dimension: 'estado_pedido', estado: 'entregado', grupo: null, cantidad: 3650 }, { dimension: 'novedad', estado: null, grupo: null, cantidad: 12 }],
      };
      return { data: filas[nombre] ?? [], error: null };
    },
  };
  return { cliente: cliente as unknown as Cliente, tablas, rpcs };
}

describe('cargarDashboard (camino rápido)', () => {
  // 12 meses de estadísticas: 365 días × 5 métodos de Colombia = 1 825 filas (2 páginas de lectura).
  const todos = dias('2025-11-01', '2026-10-31');
  const filas = todos.flatMap((d) => METODOS.map((m) => stats(d, m, m === 'wompi' ? { orders_created: 10, orders_paid: 10, gross_sales: 1_000_000, confirmed_revenue: 900_000, delivered_count: 8 } : {})));
  const f = { pais: 'CO' as const, rango: { desde: '2025-11-01', hasta: '2026-10-31' }, preset: null };

  it('con 12 meses de datos no toca orders, calcula en una fracción del presupuesto y cuadra los totales', async () => {
    const { cliente, tablas, rpcs } = clienteSimulado(filas);
    const t0 = performance.now();
    const v = await cargarDashboard(cliente, f, { cache: { almacen: null } });
    const ms = performance.now() - t0;

    expect(tablas).not.toContain('orders'); // ninguna consulta recorre pedidos
    expect(rpcs.sort()).toEqual(['metricas_panel_guias', 'metricas_top_agrupado', 'metricas_top_agrupado', 'metricas_top_agrupado', 'metricas_top_ciudades', 'metricas_top_departamentos', 'metricas_top_productos']);
    expect(ms).toBeLessThan(1500); // §21.4 (aquí sin latencia de red: solo el costo de cálculo y mapeo)

    const r = v.paises[0]!.actual.resumen;
    expect(r.pedidosPagados).toBe(3650); // 10 por día
    expect(r.ventasBrutas).toBe(365_000_000n);
    expect(r.ingresosConfirmados).toBe(328_500_000n);
    expect(v.paises[0]!.actual.serie).toHaveLength(365);
    expect(v.paises[0]!.actual.ciudades[0]!.ciudad).toBe('Medellín');
    expect(v.nombres.codigos).toEqual({ c1: 'IZAO10' });
    expect(v.truncado).toBe(false);
    // El panel de guías cuenta 3 650 pedidos y las estadísticas también: sin aviso de desfase.
    expect(v.coherencia).toEqual({ estadisticas: 3650, panel: 3650 });
  });

  it('el periodo anterior sale solo de las estadísticas (sin tops) y la variación se calcula', async () => {
    const { cliente } = clienteSimulado(filas);
    const v = await cargarDashboard(cliente, { pais: 'CO', rango: { desde: '2026-10-01', hasta: '2026-10-31' }, preset: 'mes_anterior' }, { cache: { almacen: null } });
    expect(v.paises[0]!.anterior.ciudades).toEqual([]);
    expect(v.paises[0]!.anterior.resumen.pedidosPagados).toBe(300); // septiembre: 30 días × 10
  });

  it('con "Todos" consolida en COP con la tasa del panel', async () => {
    const { cliente } = clienteSimulado(filas);
    const v = await cargarDashboard(cliente, { ...f, pais: 'TODOS' }, { cache: { almacen: null } });
    expect(v.paises.map((p) => p.actual.pais)).toEqual(['CO', 'EC']);
    expect(v.consolidado && !('error' in v.consolidado)).toBe(true);
  });

  it('detecta cuando las estadísticas van atrasadas respecto al panel', async () => {
    const { cliente } = clienteSimulado(filas.slice(0, 5)); // casi sin estadísticas
    const v = await cargarDashboard(cliente, f, { cache: { almacen: null } });
    expect(v.coherencia!.estadisticas).not.toBe(v.coherencia!.panel);
  });

  it('la segunda carga sale de la caché: no vuelve a llamar a las RPC', async () => {
    const guardado = new Map<string, string>();
    const almacen: AlmacenCache = { get: async (k) => guardado.get(k) ?? null, set: async (k, v) => void guardado.set(k, v) };
    const uno = clienteSimulado(filas);
    await cargarDashboard(uno.cliente, f, { cache: { almacen } });
    const dos = clienteSimulado(filas);
    const v = await cargarDashboard(dos.cliente, f, { cache: { almacen } });
    expect(uno.rpcs).toHaveLength(7);
    expect(dos.rpcs).toHaveLength(0);
    expect(v.paises[0]!.actual.productos[0]!.utilidad).toBe(50_000_000n); // los bigint sobreviven a la caché
  });
});
