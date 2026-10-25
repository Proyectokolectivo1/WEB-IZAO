import { describe, expect, it } from 'vitest';
import { clienteFalso } from '../crud/cliente-falso';
import { listarPedidos } from './detalle-servidor';
import { leerFiltrosPedido } from './filtros';

describe('listarPedidos', () => {
  it('aplica cada filtro de la URL a la consulta', async () => {
    const { cliente, filtros } = clienteFalso({ 'orders.select': { data: [], count: 0 } });
    await listarPedidos(
      cliente,
      leerFiltrosPedido({ q: 'IZ-CO_1', estado: 'pagado', pais: 'CO', metodo: 'cod', desde: '2026-10-01', hasta: '2026-10-31' }),
    );
    const deOrders = filtros.filter((f) => f.tabla === 'orders').map((f) => [f.metodo, ...f.args]);
    expect(deOrders).toEqual([
      ['ilike', 'number', '%IZ-CO\\_1%'],
      ['eq', 'status', 'pagado'],
      ['eq', 'country_code', 'CO'],
      ['eq', 'payment_method', 'cod'],
      ['gte', 'created_at', '2026-10-01T05:00:00.000Z'],
      ['lt', 'created_at', '2026-11-01T05:00:00.000Z'],
      ['order', 'created_at', { ascending: false }],
      ['range', 0, 24],
    ]);
  });

  it('busca por teléfono cuando el texto es numérico', async () => {
    const { cliente, filtros } = clienteFalso({ 'orders.select': { data: [], count: 0 } });
    await listarPedidos(cliente, leerFiltrosPedido({ q: '+57 300 123 4567' }));
    expect(filtros[0]).toMatchObject({ metodo: 'ilike', args: ['contact_phone_e164', '%573001234567%'] });
  });

  it('sin filtros solo ordena y pagina', async () => {
    const { cliente, filtros } = clienteFalso({ 'orders.select': { data: [], count: 0 } });
    await listarPedidos(cliente, leerFiltrosPedido({ page: '2' }));
    expect(filtros.map((f) => f.metodo)).toEqual(['order', 'range']);
    expect(filtros[1]!.args).toEqual([25, 49]);
  });

  it('filtra por estado de guía, grupo y novedad uniendo el envío (enlaces del dashboard)', async () => {
    const { cliente, filtros, llamadas } = clienteFalso({ 'orders.select': { data: [], count: 0 } });
    await listarPedidos(cliente, leerFiltrosPedido({ guia: 'En reparto', grupo: 'En tránsito', novedad: '1', pais: 'EC' }));
    const deOrders = filtros.filter((f) => f.tabla === 'orders').map((f) => [f.metodo, ...f.args]);
    expect(deOrders.slice(0, 4)).toEqual([
      ['eq', 'shipments.provider_status_name', 'En reparto'],
      ['eq', 'shipments.provider_status_parent', 'En tránsito'],
      ['eq', 'shipments.has_novelty', true],
      ['eq', 'country_code', 'EC'],
    ]);
    expect(String(llamadas.find((l) => l.clave === 'orders.select')!.args[0])).toContain('shipments!inner');
  });

  it('propaga el error de la base', async () => {
    const { cliente } = clienteFalso({ 'orders.select': { error: { message: 'boom' } } });
    await expect(listarPedidos(cliente, leerFiltrosPedido({}))).rejects.toThrow(/boom/);
  });
});
