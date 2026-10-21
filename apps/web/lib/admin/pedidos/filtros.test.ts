import { describe, expect, it } from 'vitest';
import { fechaValida, interpretarBusqueda, leerFiltrosPedido, parametrosDeFiltros, rangoFechasUtc } from './filtros';

describe('leerFiltrosPedido', () => {
  it('lee filtros válidos y descarta los desconocidos', () => {
    const f = leerFiltrosPedido({ estado: 'pagado', pais: 'ec', metodo: 'cod', desde: '2026-10-01', hasta: '2026-10-20', page: '3' });
    expect(f).toMatchObject({ estado: 'pagado', pais: 'EC', metodo: 'cod', desde: '2026-10-01', hasta: '2026-10-20', pagina: 3 });
    const malo = leerFiltrosPedido({ estado: 'inventado', pais: 'MX', metodo: 'efectivo', desde: '2026-02-30', hasta: 'ayer', page: '-4' });
    expect(malo).toMatchObject({ estado: '', pais: '', metodo: '', desde: '', hasta: '', pagina: 1 });
  });

  it('intercambia un rango invertido', () => {
    const f = leerFiltrosPedido({ desde: '2026-10-20', hasta: '2026-10-01' });
    expect([f.desde, f.hasta]).toEqual(['2026-10-01', '2026-10-20']);
  });

  it('toma el primer valor si el parámetro se repite', () => {
    expect(leerFiltrosPedido({ estado: ['cancelado', 'pagado'] }).estado).toBe('cancelado');
  });

  it('conserva solo parámetros con valor al paginar', () => {
    const f = leerFiltrosPedido({ estado: 'pagado', q: 'IZ' });
    expect(parametrosDeFiltros(f)).toEqual({ q: 'IZ', estado: 'pagado' });
  });
});

describe('fechas', () => {
  it('valida fechas reales', () => {
    expect(fechaValida('2026-10-21')).toBe(true);
    expect(fechaValida('2026-13-01')).toBe(false);
    expect(fechaValida('2026-02-29')).toBe(false);
    expect(fechaValida('21/10/2026')).toBe(false);
  });

  it('convierte el día completo en hora de Colombia a UTC (hasta es exclusivo)', () => {
    expect(rangoFechasUtc({ desde: '2026-10-01', hasta: '2026-10-31' })).toEqual({
      desde: '2026-10-01T05:00:00.000Z',
      hasta: '2026-11-01T05:00:00.000Z',
    });
    expect(rangoFechasUtc({ desde: '', hasta: '' })).toEqual({});
  });
});

describe('interpretarBusqueda', () => {
  it('reconoce teléfonos y números de pedido', () => {
    expect(interpretarBusqueda('+57 300 123 4567')).toEqual({ campo: 'contact_phone_e164', patron: '573001234567' });
    expect(interpretarBusqueda('3001234567')).toEqual({ campo: 'contact_phone_e164', patron: '3001234567' });
    expect(interpretarBusqueda('IZ-CO-000123')).toEqual({ campo: 'number', patron: 'IZ-CO-000123' });
    expect(interpretarBusqueda('000123')).toEqual({ campo: 'number', patron: '000123' });
    expect(interpretarBusqueda('   ')).toBeNull();
  });
});
