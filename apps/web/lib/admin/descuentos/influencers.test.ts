import { describe, expect, it } from 'vitest';
import type { PedidoMetrica } from '@izao/core/metrics';
import {
  centesimasATexto,
  enlaceReferido,
  esquemaInfluencer,
  porcentajeACentesimas,
  reportePorInfluencer,
} from './influencers';

const ficha = { name: 'Ana Gómez', country_code: 'CO' };

function errores(e: Record<string, unknown>): Record<string, string> {
  const r = esquemaInfluencer.safeParse({ ...ficha, ...e });
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('esquemaInfluencer', () => {
  it('normaliza usuario, correo y comisión en centésimas', () => {
    const r = esquemaInfluencer.parse({ ...ficha, handle: '@ana.g', email: ' ANA@Correo.com ', commission_pct: '12,5', is_active: 'on' });
    expect(r).toMatchObject({ handle: 'ana.g', email: 'ana@correo.com', commission_hundredths: 1250, is_active: true, phone: null, notes: null });
  });

  it('la comisión es opcional y se valida entre 0 y 100 con 2 decimales', () => {
    expect(esquemaInfluencer.parse(ficha).commission_hundredths).toBeNull();
    expect(esquemaInfluencer.parse({ ...ficha, commission_pct: '0' }).commission_hundredths).toBe(0);
    for (const v of ['101', '10.555', 'abc', '-1']) expect(errores({ commission_pct: v }).commission_pct, v).toMatch(/entre 0 y 100/);
  });

  it('valida teléfono y correo y rechaza notas que afirman originalidad', () => {
    expect(errores({ phone: 'abc' }).phone).toMatch(/teléfono/);
    expect(errores({ email: 'no-es-correo' }).email).toMatch(/correo/);
    expect(errores({ notes: 'Vende perfumes originales' }).notes).toMatch(/originalidad/);
    expect(errores({ name: 'A' }).name).toMatch(/2 caracteres/);
  });

  it('conversión de porcentajes sin floats', () => {
    expect(porcentajeACentesimas('100')).toBe(10000);
    expect(porcentajeACentesimas('7.05')).toBe(705);
    expect(centesimasATexto(1250)).toBe('12.5');
    expect(centesimasATexto(705)).toBe('7.05');
    expect(centesimasATexto(1000)).toBe('10');
  });

  it('enlace de referido por país', () => {
    expect(enlaceReferido('https://izaoperfumeria.com/', 'CO', 'ANA10')).toBe('https://izaoperfumeria.com/co?ref=ANA10');
    expect(enlaceReferido('https://izaoperfumeria.com', 'EC', 'A B')).toBe('https://izaoperfumeria.com/ec?ref=A%20B');
  });
});

function pedido(o: Partial<PedidoMetrica>): PedidoMetrica {
  return {
    id: 'o',
    pais: 'CO',
    moneda: 'COP',
    metodo: 'wompi',
    estado: 'entregado',
    creadoEn: new Date('2026-11-01T10:00:00Z'),
    pagadoEn: new Date('2026-11-01T10:05:00Z'),
    total: 100_000n,
    descuento: 0n,
    recargo: 0n,
    abono: 0n,
    recaudo: 0n,
    costoProducto: 0n,
    comisionPasarela: 0n,
    comisionPlataforma: 0n,
    envioReal: null,
    tarifaEnvio: null,
    envioEstimadoPais: 0n,
    ...o,
  };
}

describe('reportePorInfluencer', () => {
  const pedidos = [
    { influencerId: 'a', pedido: pedido({ id: '1', total: 100_000n }) },
    { influencerId: 'a', pedido: pedido({ id: '2', total: 50_001n, estado: 'en_transito' }) },
    // Contra entrega devuelta: cuenta como pagado y solo aporta el abono.
    { influencerId: 'a', pedido: pedido({ id: '3', metodo: 'cod', estado: 'devuelto', total: 120_000n, abono: 20_000n, recaudo: 100_000n }) },
    // Sin pagar: cuenta como pedido, no como venta.
    { influencerId: 'a', pedido: pedido({ id: '4', estado: 'pendiente_pago', pagadoEn: null, total: 70_000n }) },
    { influencerId: 'b', pedido: pedido({ id: '5', total: 300_000n }) },
  ];

  it('aplica las definiciones de §21.2', () => {
    const r = reportePorInfluencer(pedidos, new Map([['a', 1250], ['b', null]]));
    const a = r.find((f) => f.influencerId === 'a')!;
    expect(a.pedidos).toBe(4);
    expect(a.pedidosPagados).toBe(3);
    expect(a.ventasBrutas).toBe(270_001n);
    expect(a.entregados).toBe(1);
    expect(a.devueltos).toBe(1);
    // 100.000 (prepago entregado) + 50.001 (en tránsito, ya enviado) + 20.000 (abono del devuelto)
    expect(a.ingresosConfirmados).toBe(170_001n);
    expect(a.ticketPromedio).toBe(90_000n); // 270.001 / 3 = 90.000,33 -> 90.000
    expect(a.comision).toBe(21_250n); // 12,5 % de 170.001 = 21.250,125 -> 21.250
    const b = r.find((f) => f.influencerId === 'b')!;
    expect(b.comision).toBeNull();
  });

  it('ordena por ventas brutas descendente', () => {
    const r = reportePorInfluencer(pedidos, new Map());
    expect(r.map((f) => f.influencerId)).toEqual(['b', 'a']);
  });

  it('no mezcla monedas en un mismo influencer', () => {
    expect(() =>
      reportePorInfluencer(
        [
          { influencerId: 'a', pedido: pedido({ id: '1' }) },
          { influencerId: 'a', pedido: pedido({ id: '2', pais: 'EC', moneda: 'USD' }) },
        ],
        new Map(),
      ),
    ).toThrow(/monedas/);
  });

  it('sin pedidos pagados no hay ticket promedio', () => {
    const r = reportePorInfluencer([{ influencerId: 'a', pedido: pedido({ estado: 'pendiente_pago', pagadoEn: null }) }], new Map());
    expect(r[0]?.ticketPromedio).toBeNull();
  });
});
