import { describe, expect, it } from 'vitest';
import { resumenPais } from '@izao/core/metrics';
import { kpisDe } from './kpis';
import { anchoRelativo, formatoRoas, sentidoVariacion, textoVariacion } from './formato';

const vacio = resumenPais({ pais: 'CO', filas: [], trafico: [], gastos: [], garantias: [] });

describe('formato del dashboard', () => {
  it('ROAS en puntos básicos a veces con decimales', () => {
    expect(formatoRoas(112000n)).toBe('11,2×');
    expect(formatoRoas(100000n)).toBe('10×');
    expect(formatoRoas(12345n)).toBe('1,23×');
    expect(formatoRoas(null)).toBe('—');
  });

  it('variación con signo y sin base', () => {
    expect(textoVariacion(1250n)).toBe('+12,5 %');
    expect(textoVariacion(-300n)).toBe('-3 %');
    expect(textoVariacion(0n)).toBe('Sin cambio');
    expect(textoVariacion(null)).toBe('Sin base de comparación');
    expect(sentidoVariacion(-1n)).toBe('baja');
    expect(sentidoVariacion(null)).toBe('sin_base');
  });

  it('el ancho de las barras nunca pasa de 100 ni desaparece si hay valor', () => {
    expect(anchoRelativo(50n, 100n)).toBe(50);
    expect(anchoRelativo(1n, 100000n)).toBe(1);
    expect(anchoRelativo(5n, 0n)).toBe(0);
    expect(anchoRelativo(0n, 10n)).toBe(0);
  });
});

describe('kpisDe', () => {
  it('trae las 13 tarjetas de §21.3 y sin datos no inventa razones', () => {
    const k = kpisDe(vacio, vacio);
    expect(k.map((x) => x.id)).toEqual([
      'ingresos', 'ventas', 'utilidad', 'comisiones', 'envios', 'gastos', 'garantias', 'pagados', 'ticket', 'conversion', 'abonos', 'rechazo', 'roas',
    ]);
    expect(k.find((x) => x.id === 'ticket')?.valor).toBe('—');
    expect(k.find((x) => x.id === 'conversion')?.valor).toBe('—');
    expect(k.find((x) => x.id === 'ingresos')?.variacion).toBeNull();
  });

  it('calcula la variación contra el periodo anterior en bigint', () => {
    const actual = { ...vacio, ventasBrutas: 150000n };
    const anterior = { ...vacio, ventasBrutas: 100000n };
    expect(kpisDe(actual, anterior).find((x) => x.id === 'ventas')?.variacion).toBe(5000n);
    expect(kpisDe(actual, anterior).find((x) => x.id === 'ventas')?.valor).toMatch(/^\$\s150\.000$/);
  });
});
