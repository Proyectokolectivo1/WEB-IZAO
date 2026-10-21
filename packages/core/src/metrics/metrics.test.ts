import { describe, expect, it } from 'vitest';
import { PEDIDOS_CO, PEDIDOS_EC } from './__fixtures__/pedidos';
import {
  comisionPasarelaDePagos,
  consolidarEnCop,
  costoEnvioPedido,
  cuentaComoIngreso,
  esPagado,
  filasVentasDiarias,
  ingresoConfirmado,
  parseTasaMicro,
  razonBp,
  resumenPais,
  serieDiaria,
  variacionBp,
  type FilaVentasDiarias,
  type ResumenPais,
} from './index';

const FECHA = '2026-10-20';

const GASTOS_CO = [
  { fecha: FECHA, pais: 'CO' as const, moneda: 'COP' as const, categoria: 'pauta_meta', monto: 100_000n },
  { fecha: FECHA, pais: 'CO' as const, moneda: 'COP' as const, categoria: 'empaque', monto: 15_000n },
];
const GARANTIAS_CO = [
  { pais: 'CO' as const, estado: 'aprobada' as const, costo: 30_000n },
  { pais: 'CO' as const, estado: 'rechazada' as const, costo: 5_000n },
];
const TRAFICO_CO = [{ fecha: FECHA, pais: 'CO' as const, sesiones: 300n, vistasProducto: 120n, carrito: 40n, checkouts: 15n }];
const TRAFICO_EC = [{ fecha: FECHA, pais: 'EC' as const, sesiones: 50n, vistasProducto: 20n, carrito: 5n, checkouts: 2n }];

function fila(filas: readonly FilaVentasDiarias[], metodo: string): FilaVentasDiarias {
  const f = filas.find((x) => x.payment_method === metodo);
  if (!f) throw new Error(metodo);
  return f;
}

function resumenCo(): ResumenPais {
  return resumenPais({
    pais: 'CO',
    filas: filasVentasDiarias(PEDIDOS_CO, FECHA, 'CO'),
    trafico: TRAFICO_CO,
    gastos: GASTOS_CO,
    garantias: GARANTIAS_CO,
  });
}

function resumenEc(): ResumenPais {
  return resumenPais({
    pais: 'EC',
    filas: filasVentasDiarias(PEDIDOS_EC, FECHA, 'EC'),
    trafico: TRAFICO_EC,
    gastos: [{ fecha: FECHA, pais: 'EC', moneda: 'USD', categoria: 'otros', monto: 1_000n }],
    garantias: [],
  });
}

describe('clasificación de pedidos (§21.2)', () => {
  it('pagados: pagado/abono_pagado o posteriores; no cancelado ni requiere_reembolso', () => {
    for (const s of ['pagado', 'abono_pagado', 'error_transportadora', 'enviado_transportadora', 'en_preparacion', 'en_transito', 'entregado', 'devuelto', 'reclamacion'] as const) {
      expect(esPagado(s)).toBe(true);
    }
    for (const s of ['pendiente_pago', 'pago_rechazado', 'expirado', 'esperando_abono', 'abandonado', 'pendiente_manual', 'cancelado', 'requiere_reembolso'] as const) {
      expect(esPagado(s)).toBe(false);
    }
  });

  it('ingreso confirmado: prepago enviado = total; contra entrega entregado = abono + recaudo; devuelto = solo abono', () => {
    const [a, b, c, d, e, f, g] = PEDIDOS_CO;
    expect(ingresoConfirmado(a!)).toBe(200_000n);
    expect(ingresoConfirmado(b!)).toBe(0n); // pagado sin enviar
    expect(ingresoConfirmado(c!)).toBe(330_000n); // Addi en tránsito ya enviado
    expect(ingresoConfirmado(d!)).toBe(180_000n);
    expect(ingresoConfirmado(e!)).toBe(20_000n);
    expect(ingresoConfirmado(f!)).toBe(0n); // en tránsito: por cobrar
    expect(ingresoConfirmado(g!)).toBe(0n);
    expect(cuentaComoIngreso(e!)).toBe(true);
    expect(cuentaComoIngreso(f!)).toBe(false);
  });

  it('contra entrega en reclamación solo aporta el abono (lo único seguro)', () => {
    const d = { ...PEDIDOS_CO[3]!, estado: 'reclamacion' as const };
    expect(ingresoConfirmado(d)).toBe(20_000n);
  });

  it('costo de envío: real; si no, shippingRate; si no, estimado del país (con indicador)', () => {
    expect(costoEnvioPedido(PEDIDOS_CO[0]!)).toEqual({ valor: 12_000n, estimado: false });
    expect(costoEnvioPedido(PEDIDOS_CO[2]!)).toEqual({ valor: 11_000n, estimado: true });
    expect(costoEnvioPedido(PEDIDOS_EC[0]!)).toEqual({ valor: 500n, estimado: true });
    expect(costoEnvioPedido({ ...PEDIDOS_CO[0]!, envioReal: 0n })).toEqual({ valor: 0n, estimado: false });
  });

  it('comisión de pasarela: fee_amount real de pagos aprobados; si falta alguno, la estimada', () => {
    expect(comisionPasarelaDePagos([{ fee_amount: 1_200n }, { fee_amount: 300n }], 999n)).toBe(1_500n);
    expect(comisionPasarelaDePagos([{ fee_amount: 1_200n }, { fee_amount: null }], 999n)).toBe(999n);
    expect(comisionPasarelaDePagos([], 999n)).toBe(999n);
  });
});

describe('filas de daily_sales_stats (§21.4)', () => {
  const filas = filasVentasDiarias(PEDIDOS_CO, FECHA, 'CO');

  it('una fila por método, aunque esté en cero (para pisar valores viejos)', () => {
    expect(filas.map((f) => f.payment_method).sort()).toEqual(['addi', 'cod', 'manual', 'sistecredito', 'wompi']);
    expect(filas.every((f) => f.date === FECHA && f.country_code === 'CO' && f.currency_code === 'COP')).toBe(true);
    expect(fila(filas, 'sistecredito').orders_created).toBe(0);
  });

  it('wompi: A entregado, B pagado sin enviar, H pendiente', () => {
    expect(fila(filas, 'wompi')).toMatchObject({
      orders_created: 3,
      orders_paid: 2,
      gross_sales: 350_000n,
      discounts: 20_000n,
      prepaid_sent_value: 200_000n,
      delivered_count: 1,
      delivered_value: 200_000n,
      confirmed_revenue: 200_000n,
      gateway_fees: 6_000n, // solo A cuenta como ingreso
      product_cost: 80_000n,
      shipping_cost: 12_000n,
      shipping_estimated_count: 0,
    });
  });

  it('contra entrega: D entregado, E devuelto, F en tránsito, G abandonado, I esperando', () => {
    expect(fila(filas, 'cod')).toMatchObject({
      orders_created: 5,
      orders_paid: 3,
      orders_abandoned: 1,
      gross_sales: 440_000n,
      cod_deposits: 60_000n,
      cod_collect_sent: 120_000n,
      delivered_count: 1,
      delivered_value: 180_000n,
      returned_count: 1,
      returned_value: 120_000n,
      cod_deposits_returned: 20_000n,
      confirmed_revenue: 200_000n, // 180 000 + 20 000
      gateway_fees: 2_400n, // D + E
      carrier_platform_fees: 7_800n, // 4 800 + 3 000
      product_cost: 70_000n, // E devuelto vuelve al inventario
      shipping_cost: 38_000n, // 13 000 + 25 000
    });
  });

  it('addi: recargo incluido en ventas y envío estimado por shippingRate', () => {
    expect(fila(filas, 'addi')).toMatchObject({
      orders_paid: 1,
      gross_sales: 330_000n,
      surcharges: 30_000n,
      confirmed_revenue: 330_000n,
      shipping_cost: 11_000n,
      shipping_estimated_count: 1,
    });
  });

  it('rechaza pedidos de otro país, otra moneda u otra fecha de atribución', () => {
    expect(() => filasVentasDiarias(PEDIDOS_EC, FECHA, 'CO')).toThrow(RangeError);
    expect(() => filasVentasDiarias([{ ...PEDIDOS_CO[0]!, moneda: 'USD' }], FECHA, 'CO')).toThrow(RangeError);
    expect(() => filasVentasDiarias(PEDIDOS_CO, '2026-10-21', 'CO')).toThrow(RangeError);
  });

  it('atribución: paid_at en Bogotá; si no se pagó, created_at', () => {
    const tarde = { ...PEDIDOS_CO[0]!, pagadoEn: new Date('2026-10-21T04:59:59Z') }; // 23:59:59 del 20
    expect(() => filasVentasDiarias([tarde], FECHA, 'CO')).not.toThrow();
    const otroDia = { ...PEDIDOS_CO[0]!, pagadoEn: new Date('2026-10-21T05:00:00Z') };
    expect(() => filasVentasDiarias([otroDia], FECHA, 'CO')).toThrow(RangeError);
  });
});

describe('resumen por país (§21.2), Colombia', () => {
  const r = resumenCo();

  it('ventas, pedidos e ingresos confirmados', () => {
    expect(r.moneda).toBe('COP');
    expect(r.pedidosCreados).toBe(9);
    expect(r.pedidosPagados).toBe(6);
    expect(r.ventasBrutas).toBe(1_120_000n);
    expect(r.descuentos).toBe(20_000n);
    expect(r.recargos).toBe(30_000n);
    expect(r.ingresosConfirmados).toBe(730_000n); // 200 000 + 330 000 + 180 000 + 20 000
    expect(r.porCobrarEnTransito).toBe(120_000n);
  });

  it('comisiones desglosadas por proveedor', () => {
    expect(r.comisiones).toEqual({ wompi: 8_400n, addi: 33_000n, sistecredito: 0n, mastershop: 7_800n, total: 49_200n });
  });

  it('costos, garantías, gastos y utilidad neta', () => {
    expect(r.costoProducto).toBe(270_000n);
    expect(r.costoEnvios).toBe(61_000n);
    expect(r.enviosEstimados).toBe(1);
    expect(r.garantias).toEqual({ casos: 2, porEstado: { aprobada: 1, rechazada: 1 }, costo: 30_000n, tasaBp: 10_000n });
    expect(r.gastos).toEqual({ total: 115_000n, porCategoria: { pauta_meta: 100_000n, empaque: 15_000n } });
    expect(r.gastoPauta).toBe(100_000n);
    // 730 000 − 49 200 − 270 000 − 61 000 − 30 000 − 115 000
    expect(r.utilidadNeta).toBe(204_800n);
  });

  it('razones en puntos básicos (× 10 000), sin float', () => {
    expect(r.margenNetoBp).toBe(2_805n); // 204 800 / 730 000 = 28,0548 %
    expect(r.ticketPromedio).toBe(186_667n); // 1 120 000 / 6 = 186 666,67
    expect(r.conversionBp).toBe(200n); // 6 / 300
    expect(r.abonosPagadosBp).toBe(7_500n); // 3 / (3 + 1)
    expect(r.rechazoContraEntregaBp).toBe(5_000n); // 1 / 2
    expect(r.roasBp).toBe(112_000n); // 11,2×
  });

  it('embudo y ventas por método', () => {
    expect(r.embudo).toEqual({ sesiones: 300n, vistasProducto: 120n, carrito: 40n, checkouts: 15n, pagados: 6n });
    expect(r.porMetodo.addi).toEqual({ pedidosPagados: 1, ventasBrutas: 330_000n, recargos: 30_000n });
    expect(r.porMetodo.cod.ventasBrutas).toBe(440_000n);
  });

  it('ningún monto es number', () => {
    for (const v of [r.ventasBrutas, r.ingresosConfirmados, r.utilidadNeta, r.costoEnvios, r.comisiones.total]) {
      expect(typeof v).toBe('bigint');
    }
  });

  it('rechaza mezclar monedas: fila o gasto en otra moneda', () => {
    const filasEc = filasVentasDiarias(PEDIDOS_EC, FECHA, 'EC');
    expect(() => resumenPais({ pais: 'CO', filas: filasEc, trafico: [], gastos: [], garantias: [] })).toThrow(RangeError);
    expect(() =>
      resumenPais({ pais: 'CO', filas: [], trafico: [], gastos: [{ ...GASTOS_CO[0]!, moneda: 'USD' }], garantias: [] }),
    ).toThrow(RangeError);
  });

  it('sin datos: razones nulas, no división por cero', () => {
    const v = resumenPais({ pais: 'CO', filas: [], trafico: [], gastos: [], garantias: [] });
    expect(v.ticketPromedio).toBeNull();
    expect(v.margenNetoBp).toBeNull();
    expect(v.conversionBp).toBeNull();
    expect(v.roasBp).toBeNull();
    expect(v.garantias.tasaBp).toBeNull();
  });
});

describe('Ecuador (USD en centavos) y consolidado en COP', () => {
  const ec = resumenEc();

  it('Ecuador por separado en USD', () => {
    expect(ec.moneda).toBe('USD');
    expect(ec.ventasBrutas).toBe(4_599n);
    expect(ec.ingresosConfirmados).toBe(4_599n);
    expect(ec.costoEnvios).toBe(500n);
    expect(ec.enviosEstimados).toBe(1);
    expect(ec.utilidadNeta).toBe(1_099n); // 4 599 − 2 000 − 500 − 1 000
    expect(ec.margenNetoBp).toBe(2_390n); // 23,8965 %
    expect(ec.roasBp).toBeNull(); // sin pauta
  });

  it('consolidado en COP con fx_rate_to_cop (4000,5 COP por USD)', () => {
    const c = consolidarEnCop([resumenCo(), ec], { EC: '4000.500000' });
    if ('error' in c) throw new Error(c.error);
    expect(c.moneda).toBe('COP');
    // 4 599 centavos × 4000,5 / 100 = 183 982,995 → 183 983
    expect(c.ventasBrutas).toBe(1_303_983n);
    expect(c.ingresosConfirmados).toBe(913_983n);
    expect(c.costoProducto).toBe(350_010n); // 270 000 + 80 010
    expect(c.costoEnvios).toBe(81_003n); // 61 000 + 20 002,5 → 20 003
    expect(c.gastos.total).toBe(155_005n);
    expect(c.utilidadNeta).toBe(248_765n); // recalculada con los componentes convertidos
    expect(c.pedidosPagados).toBe(7);
    expect(c.ticketPromedio).toBe(186_283n); // 1 303 983 / 7
    expect(c.conversionBp).toBe(200n); // 7 / 350
    expect(c.roasBp).toBe(130_398n);
  });

  it('sin tasa de un país en USD no consolida (no inventa la tasa)', () => {
    expect(consolidarEnCop([resumenCo(), ec], {})).toEqual({ error: 'sin_tasa', pais: 'EC' });
    expect(consolidarEnCop([resumenCo(), ec], { EC: '0' })).toEqual({ error: 'sin_tasa', pais: 'EC' });
  });
});

describe('serie diaria', () => {
  it('rellena días sin filas en cero y no mezcla monedas', () => {
    const filas = filasVentasDiarias(PEDIDOS_CO, FECHA, 'CO');
    expect(serieDiaria(filas, ['2026-10-19', FECHA])).toEqual([
      { fecha: '2026-10-19', ventasBrutas: 0n, ingresosConfirmados: 0n, pedidosPagados: 0 },
      { fecha: FECHA, ventasBrutas: 1_120_000n, ingresosConfirmados: 730_000n, pedidosPagados: 6 },
    ]);
    const mezcla = [...filas, ...filasVentasDiarias(PEDIDOS_EC, FECHA, 'EC')];
    expect(() => serieDiaria(mezcla, [FECHA])).toThrow(RangeError);
  });
});

describe('utilidades numéricas', () => {
  it('razonBp redondea medio hacia arriba y devuelve null con denominador 0', () => {
    expect(razonBp(1n, 3n)).toBe(3_333n);
    expect(razonBp(2n, 3n)).toBe(6_667n);
    expect(razonBp(-1n, 8n)).toBe(-1_250n);
    expect(razonBp(5n, 0n)).toBeNull();
  });

  it('variación contra el periodo anterior', () => {
    expect(variacionBp(110n, 100n)).toBe(1_000n);
    expect(variacionBp(90n, 100n)).toBe(-1_000n);
    expect(variacionBp(-50n, -100n)).toBe(5_000n); // pérdida que se reduce a la mitad
    expect(variacionBp(5n, 0n)).toBeNull();
  });

  it('parseTasaMicro: hasta 6 decimales, positiva', () => {
    expect(parseTasaMicro('4000.5')).toBe(4_000_500_000n);
    expect(parseTasaMicro('4100.000000')).toBe(4_100_000_000n);
    expect(parseTasaMicro(4100)).toBe(4_100_000_000n);
    expect(parseTasaMicro('0')).toBeNull();
    expect(parseTasaMicro('1.1234567')).toBeNull();
    expect(parseTasaMicro(null)).toBeNull();
    expect(parseTasaMicro('-3')).toBeNull();
  });
});
