import { describe, expect, it } from 'vitest';
import { leerFiltroFechas, parametrosFechas } from './filtros';

// 2026-11-15 23:30 en Bogotá (UTC−5) ya es 2026-11-16 04:30 UTC.
const ahora = new Date('2026-11-16T04:30:00Z');

describe('leerFiltroFechas', () => {
  it('usa este mes por defecto, en hora de Bogotá', () => {
    const f = leerFiltroFechas({}, ahora);
    expect(f).toMatchObject({ preset: 'este_mes', corregido: false, rango: { desde: '2026-11-01', hasta: '2026-11-15' } });
  });

  it('acepta un preset conocido y descarta uno desconocido', () => {
    expect(leerFiltroFechas({ rango: 'hoy' }, ahora).rango).toEqual({ desde: '2026-11-15', hasta: '2026-11-15' });
    expect(leerFiltroFechas({ rango: 'ultimos_7_dias' }, ahora).rango.desde).toBe('2026-11-09');
    expect(leerFiltroFechas({ rango: 'mañana' }, ahora).preset).toBe('este_mes');
  });

  it('acepta un rango personalizado válido', () => {
    const f = leerFiltroFechas({ desde: '2026-01-01', hasta: '2026-03-31' }, ahora);
    expect(f).toEqual({ preset: null, rango: { desde: '2026-01-01', hasta: '2026-03-31' }, corregido: false });
    expect(parametrosFechas(f)).toEqual({ desde: '2026-01-01', hasta: '2026-03-31' });
    expect(parametrosFechas(leerFiltroFechas({ rango: 'ayer' }, ahora))).toEqual({ rango: 'ayer' });
  });

  it('corrige rangos invertidos, falsos o de más de 12 meses', () => {
    for (const sp of [
      { desde: '2026-03-01', hasta: '2026-01-01' },
      { desde: '2026-02-30', hasta: '2026-03-05' },
      { desde: '2024-01-01', hasta: '2026-01-01' },
      { desde: '2026-01-01' },
      { desde: 'x', hasta: 'y' },
    ]) {
      const f = leerFiltroFechas(sp, ahora);
      expect(f.corregido, JSON.stringify(sp)).toBe(true);
      expect(f.preset).toBe('este_mes');
    }
  });
});
