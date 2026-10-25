import { describe, expect, it } from 'vitest';
import type { PedidoMetrica } from '@izao/core/metrics';
import {
  filasDePedidos,
  fuenteDeVenta,
  modeloPais,
  panelGuias,
  topCiudades,
  topCodigos,
  topDepartamentos,
  topFuentes,
  topProductos,
  type ItemMetrica,
  type PedidoDetalle,
} from './dashboard';

const RANGO = { desde: '2026-11-02', hasta: '2026-11-03' };

function pm(o: Partial<PedidoMetrica> & { id: string }): PedidoMetrica {
  return {
    pais: 'CO',
    moneda: 'COP',
    metodo: 'wompi',
    estado: 'entregado',
    creadoEn: new Date('2026-11-02T10:00:00-05:00'),
    pagadoEn: new Date('2026-11-02T10:05:00-05:00'),
    total: 0n,
    descuento: 0n,
    recargo: 0n,
    abono: 0n,
    recaudo: 0n,
    costoProducto: 0n,
    comisionPasarela: 0n,
    comisionPlataforma: 0n,
    envioReal: null,
    tarifaEnvio: null,
    envioEstimadoPais: 12000n,
    ...o,
  };
}

const item = (o: Partial<ItemMetrica> & { productoId: string }): ItemMetrica => ({
  sku: 'SKU',
  nombre: 'Producto',
  cantidad: 1,
  precioUnitario: 0n,
  costoUnitario: null,
  descuentoLinea: 0n,
  ...o,
});

function det(pedido: PedidoMetrica, o: Partial<PedidoDetalle> = {}): PedidoDetalle {
  return { pedido, numero: pedido.id, ciudad: null, departamento: null, codigoId: null, influencerId: null, fuente: 'Directo o sin fuente', items: [], guia: null, ...o };
}

/** Cuatro pedidos de Colombia calculados a mano (ver comentarios). */
const o1 = det(
  pm({ id: 'o1', total: 100000n, descuento: 5000n, costoProducto: 40000n, comisionPasarela: 3000n, comisionPlataforma: 800n, envioReal: 9000n }),
  {
    ciudad: 'Medellín',
    departamento: 'Antioquia',
    codigoId: 'c1',
    influencerId: 'i1',
    fuente: 'instagram / story',
    items: [item({ productoId: 'A', nombre: 'Perfume A', cantidad: 2, precioUnitario: 50000n, costoUnitario: 20000n })],
    guia: { estado: 'Entregado', grupo: 'Finalizadas', novedad: false },
  },
);
const o2 = det(
  pm({ id: 'o2', metodo: 'cod', estado: 'devuelto', total: 80000n, abono: 20000n, recaudo: 60000n, costoProducto: 30000n, comisionPasarela: 1000n, tarifaEnvio: 10000n }),
  {
    ciudad: 'Medellín',
    departamento: 'Antioquia',
    items: [item({ productoId: 'B', nombre: 'Perfume B', precioUnitario: 80000n, costoUnitario: 30000n })],
    guia: { estado: 'Devuelto al remitente', grupo: 'Finalizadas', novedad: true },
  },
);
const o3 = det(pm({ id: 'o3', metodo: 'cod', estado: 'esperando_abono', pagadoEn: null, creadoEn: new Date('2026-11-03T09:00:00-05:00'), total: 50000n, abono: 10000n, recaudo: 40000n }));
const o4 = det(
  pm({ id: 'o4', estado: 'pagado', pagadoEn: new Date('2026-11-03T15:00:00-05:00'), total: 60000n, costoProducto: 20000n }),
  {
    ciudad: 'Bogotá',
    departamento: 'Bogotá D.C.',
    codigoId: 'c1',
    items: [item({ productoId: 'A', nombre: 'Perfume A', precioUnitario: 60000n, costoUnitario: 20000n, descuentoLinea: 0n })],
    guia: { estado: 'Pendiente de recolección', grupo: 'Por preparar', novedad: false },
  },
);
const TODOS = [o1, o2, o3, o4];

describe('filasDePedidos', () => {
  it('agrupa por día de atribución y devuelve las 5 filas por día', () => {
    const { filas, descartados } = filasDePedidos(TODOS.map((d) => d.pedido), 'CO');
    expect(descartados).toBe(0);
    expect(filas).toHaveLength(10);
    expect([...new Set(filas.map((f) => f.date))]).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('descarta pedidos de otro país o moneda en vez de lanzar', () => {
    const raro = pm({ id: 'x', pais: 'EC', moneda: 'USD' });
    const { descartados } = filasDePedidos([raro], 'CO');
    expect(descartados).toBe(1);
  });

  it('el método manual nunca trae comisión de pasarela', () => {
    const manual = pm({ id: 'm', metodo: 'manual', estado: 'enviado_transportadora', total: 1000n, comisionPasarela: 55n });
    expect(() => filasDePedidos([manual], 'CO')).not.toThrow();
  });
});

describe('modeloPais', () => {
  const m = modeloPais({ pais: 'CO', detalles: TODOS, trafico: [], gastos: [], garantias: [] }, RANGO);
  const r = m.resumen;

  it('KPIs según §21.2', () => {
    expect(r.pedidosCreados).toBe(4);
    expect(r.pedidosPagados).toBe(3);
    expect(r.ventasBrutas).toBe(240000n);
    // o1 (prepago enviado: 100 000) + o2 (contra entrega devuelta: solo el abono 20 000)
    expect(r.ingresosConfirmados).toBe(120000n);
    expect(r.comisiones).toMatchObject({ wompi: 4000n, mastershop: 800n, total: 4800n });
    expect(r.costoProducto).toBe(40000n); // el devuelto regresa al inventario
    expect(r.costoEnvios).toBe(19000n); // 9 000 real + 10 000 shippingRate de o2
    expect(r.enviosEstimados).toBe(1);
    expect(r.utilidadNeta).toBe(56200n);
    expect(r.margenNetoBp).toBe(4683n);
    expect(r.ticketPromedio).toBe(80000n);
    expect(r.rechazoContraEntregaBp).toBe(10000n);
    expect(r.conversionBp).toBeNull(); // sin sesiones no se inventa una tasa
    expect(r.roasBp).toBeNull();
  });

  it('la serie diaria cubre todos los días del rango, también los vacíos', () => {
    expect(m.serie.map((p) => [p.fecha, p.ventasBrutas, p.ingresosConfirmados])).toEqual([
      ['2026-11-02', 180000n, 120000n],
      ['2026-11-03', 60000n, 0n],
    ]);
  });

  it('suma tráfico, gastos y garantías en el resumen', () => {
    const c = modeloPais(
      {
        pais: 'CO',
        detalles: TODOS,
        trafico: [{ fecha: '2026-11-02', pais: 'CO', sesiones: 100n, vistasProducto: 60n, carrito: 20n, checkouts: 10n }],
        gastos: [{ fecha: '2026-11-02', pais: 'CO', moneda: 'COP', categoria: 'pauta_meta', monto: 24000n }],
        garantias: [{ pais: 'CO', estado: 'aprobada', costo: 5000n }],
      },
      RANGO,
    ).resumen;
    expect(c.conversionBp).toBe(300n); // 3 pagados / 100 sesiones
    expect(c.gastos.total).toBe(24000n);
    expect(c.roasBp).toBe(100000n); // 240 000 / 24 000 = 10×
    expect(c.garantias.costo).toBe(5000n);
    expect(c.utilidadNeta).toBe(56200n - 24000n - 5000n);
  });
});

describe('tops', () => {
  it('ciudades: solo pedidos pagados, % devolución sobre finalizados', () => {
    const t = topCiudades(TODOS);
    expect(t.map((c) => [c.ciudad, c.pedidos, c.ventasBrutas, c.devolucionBp])).toEqual([
      ['Medellín', 2, 180000n, 5000n],
      ['Bogotá', 1, 60000n, null],
    ]);
    expect(topDepartamentos(TODOS)[0]).toMatchObject({ departamento: 'Antioquia', pedidos: 2 });
  });

  it('productos: excluye devueltos; utilidad = ventas − costo', () => {
    const t = topProductos(TODOS);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ nombre: 'Perfume A', unidades: 3, ventas: 160000n, costo: 60000n, utilidad: 100000n });
  });

  it('productos: el descuento de la línea resta y la falta de costo se avisa', () => {
    const d = det(pm({ id: 'z', total: 90000n }), {
      items: [item({ productoId: 'Z', cantidad: 2, precioUnitario: 50000n, costoUnitario: null, descuentoLinea: 10000n })],
    });
    expect(topProductos([d])[0]).toMatchObject({ ventas: 90000n, costo: 0n, unidadesSinCosto: 2 });
  });

  it('códigos y fuentes agrupan pedidos, ventas e ingresos', () => {
    const c = topCodigos(TODOS);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ clave: 'c1', pedidos: 2, pagados: 2, ventasBrutas: 160000n, ingresosConfirmados: 100000n });
    expect(topFuentes(TODOS).map((f) => f.clave)).toContain('instagram / story');
  });
});

describe('panelGuias', () => {
  const p = panelGuias(TODOS);
  it('cuenta por estado del pedido, por estado de guía y por grupo', () => {
    expect(p.porEstadoPedido).toEqual({ entregado: 1, devuelto: 1, esperando_abono: 1, pagado: 1 });
    expect(p.porGrupo).toEqual([
      { grupo: 'Finalizadas', cantidad: 2 },
      { grupo: 'Por preparar', cantidad: 1 },
    ]);
    expect(p.porEstadoGuia).toHaveLength(3);
    expect(p.conNovedad).toBe(1);
    expect(p.abonosPendientes).toBe(1);
    expect(p.errorTransportadora).toBe(0);
  });
});

describe('fuenteDeVenta', () => {
  it('prioriza UTM, luego el clic de anuncio, y si no hay nada dice que es directo', () => {
    expect(fuenteDeVenta({ utm_source: 'Facebook', utm_medium: 'CPC' }, {})).toBe('facebook / cpc');
    expect(fuenteDeVenta({ source: 'google' }, null)).toBe('google');
    expect(fuenteDeVenta({}, { fbclid: 'abc' })).toBe('meta (clic de anuncio)');
    expect(fuenteDeVenta({}, { gclid: 'abc' })).toBe('google (clic de anuncio)');
    expect(fuenteDeVenta(null, undefined)).toBe('Directo o sin fuente');
    expect(fuenteDeVenta({ utm_source: 123 }, {})).toBe('Directo o sin fuente');
  });
});
