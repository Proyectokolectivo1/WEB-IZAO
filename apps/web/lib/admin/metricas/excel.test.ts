import { describe, expect, it } from 'vitest';
import { consolidarEnCop, type PedidoMetrica } from '@izao/core/metrics';
import { crearLibroXlsx } from '../excel/libro';
import { modeloPais, type PedidoDetalle } from './dashboard';
import { hojasDelDashboard } from './excel';
import type { VistaDetallada } from './servidor';

const RANGO = { desde: '2026-11-02', hasta: '2026-11-03' };

const pedido: PedidoMetrica = {
  id: 'o1',
  pais: 'CO',
  moneda: 'COP',
  metodo: 'wompi',
  estado: 'entregado',
  creadoEn: new Date('2026-11-02T10:00:00-05:00'),
  pagadoEn: new Date('2026-11-02T10:05:00-05:00'),
  total: 100000n,
  descuento: 0n,
  recargo: 0n,
  abono: 0n,
  recaudo: 0n,
  costoProducto: 40000n,
  comisionPasarela: 3000n,
  comisionPlataforma: 0n,
  envioReal: 9000n,
  tarifaEnvio: null,
  envioEstimadoPais: 12000n,
};
const detalle: PedidoDetalle = {
  pedido,
  numero: 'IZ-CO-000001',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  codigoId: 'c1',
  influencerId: 'i1',
  fuente: '=HYPERLINK("http://malo")',
  items: [{ productoId: 'A', sku: 'A', nombre: 'Perfume A', cantidad: 1, precioUnitario: 100000n, costoUnitario: 40000n, descuentoLinea: 0n }],
  guia: { estado: 'Entregado', grupo: 'Finalizadas', novedad: false },
};

function vista(): VistaDetallada {
  const datos = { pais: 'CO' as const, detalles: [detalle], trafico: [], gastos: [], garantias: [] };
  const actual = modeloPais(datos, RANGO);
  const anterior = modeloPais({ ...datos, detalles: [] }, { desde: '2026-10-31', hasta: '2026-11-01' });
  const consolidado = consolidarEnCop([actual.resumen], { CO: 1 });
  if ('error' in consolidado) throw new Error('sin tasa');
  return {
    pais: 'TODOS',
    rango: RANGO,
    anterior: { desde: '2026-10-31', hasta: '2026-11-01' },
    paises: [{ actual, anterior, detalles: [detalle] }],
    consolidado: { actual: consolidado, anterior: consolidado },
    nombres: { codigos: { c1: 'IZAO10' }, influencers: { i1: 'Laura' } },
    truncado: false,
    coherencia: null,
  };
}

describe('hojasDelDashboard', () => {
  const hojas = hojasDelDashboard(vista());

  it('trae las 8 hojas de §21.3 en orden', () => {
    expect(hojas.map((h) => h.nombre)).toEqual(['Resumen', 'Pedidos', 'Ciudades', 'Productos', 'Métodos de pago', 'Gastos', 'Garantías', 'Influencers']);
  });

  it('cada fila tiene tantas celdas como columnas', () => {
    for (const h of hojas) for (const f of h.filas) expect(f.length, h.nombre).toBe(h.columnas.length);
  });

  it('el resumen incluye el consolidado y los montos son números con moneda, no texto', () => {
    const r = hojas[0]!;
    expect(r.columnas.map((c) => c.titulo).join('|')).toContain('Consolidado en COP');
    const ventas = r.filas.find((f) => f[0] === 'Ventas brutas')!;
    expect(ventas[1]).toEqual({ tipo: 'monto', valor: 100000n, moneda: 'COP' });
    const utilidad = r.filas.find((f) => f[0] === 'Utilidad neta')!;
    expect(utilidad[1]).toEqual({ tipo: 'monto', valor: 48000n, moneda: 'COP' }); // 100 000 − 3 000 − 40 000 − 9 000
  });

  it('el detalle de pedidos resuelve nombres de código e influencer', () => {
    const fila = hojas[1]!.filas[0]!;
    expect(fila).toContain('IZ-CO-000001');
    expect(fila).toContain('IZAO10');
    expect(fila).toContain('Laura');
  });

  it('genera un .xlsx válido (ZIP) con las 8 hojas', () => {
    const libro = crearLibroXlsx(hojas);
    expect(libro.subarray(0, 2).toString()).toBe('PK');
    expect(libro.includes(Buffer.from('xl/worksheets/sheet8.xml'))).toBe(true);
  });
});
