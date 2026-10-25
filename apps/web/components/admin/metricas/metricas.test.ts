import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PedidoMetrica } from '@izao/core/metrics';
import { modeloPais, type PedidoDetalle } from '@/lib/admin/metricas/dashboard';
import { SeccionPaisMetricas } from './SeccionPaisMetricas';

// La configuración de Vitest compila JSX clásico: el componente busca `React` global al renderizar.
(globalThis as { React?: unknown }).React = React;

const RANGO = { desde: '2026-11-02', hasta: '2026-11-04' };
const pedido: PedidoMetrica = {
  id: 'o1',
  pais: 'CO',
  moneda: 'COP',
  metodo: 'cod',
  estado: 'en_transito',
  creadoEn: new Date('2026-11-02T10:00:00-05:00'),
  pagadoEn: new Date('2026-11-02T10:05:00-05:00'),
  total: 100000n,
  descuento: 0n,
  recargo: 0n,
  abono: 20000n,
  recaudo: 80000n,
  costoProducto: 40000n,
  comisionPasarela: 1000n,
  comisionPlataforma: 0n,
  envioReal: null,
  tarifaEnvio: null,
  envioEstimadoPais: 12000n,
};
const detalle: PedidoDetalle = {
  pedido,
  numero: 'IZ-CO-000001',
  ciudad: 'Cali',
  departamento: 'Valle del Cauca',
  codigoId: 'c1',
  influencerId: 'i1',
  fuente: 'tiktok',
  items: [{ productoId: 'A', sku: 'A', nombre: '<b>Perfume</b>', cantidad: 1, precioUnitario: 100000n, costoUnitario: null, descuentoLinea: 0n }],
  guia: { estado: 'En reparto', grupo: 'En tránsito', novedad: true },
};

function html(detalles: PedidoDetalle[]): string {
  const datos = { pais: 'CO' as const, detalles, trafico: [], gastos: [], garantias: [] };
  const actual = modeloPais(datos, RANGO);
  const anterior = modeloPais({ ...datos, detalles: [] }, { desde: '2026-10-30', hasta: '2026-11-01' });
  return renderToStaticMarkup(
    createElement(SeccionPaisMetricas, {
      vista: { actual, anterior, detalles },
      nombres: { codigos: { c1: 'IZAO10' }, influencers: { i1: 'Laura' } },
      rango: RANGO,
    }),
  );
}

describe('SeccionPaisMetricas', () => {
  it('muestra KPIs, panel de guías con enlaces a la lista filtrada y los tops', () => {
    const h = html([detalle]);
    expect(h).toContain('Ingresos totales');
    expect(h).toContain('/admin/pedidos?pais=CO&amp;desde=2026-11-02&amp;hasta=2026-11-04&amp;estado=en_transito');
    expect(h).toContain('novedad=1');
    expect(h).toContain('guia=En+reparto');
    expect(h).toContain('grupo=En+tr%C3%A1nsito');
    expect(h).toContain('Valle del Cauca');
    expect(h).toContain('IZAO10');
    expect(h).toContain('Laura');
    expect(h).toContain('tiktok');
    expect(h).toContain('role="img"'); // la gráfica tiene alternativa en texto
  });

  it('escapa los nombres de producto (nada de HTML crudo)', () => {
    const h = html([detalle]);
    expect(h).not.toContain('<b>Perfume</b>');
    expect(h).toContain('&lt;b&gt;Perfume&lt;/b&gt;');
  });

  it('sin pedidos muestra los vacíos en vez de fallar', () => {
    const h = html([]);
    expect(h).toContain('Sin datos en este periodo.');
    expect(h).toContain('Sin sesiones registradas');
  });
});
