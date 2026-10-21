import { describe, expect, it } from 'vitest';
import { diasEntre, fechaBogota, inicioDiaBogotaUtc, periodoAnterior, rangoPreset } from './fechas';

// Miércoles 21 de octubre de 2026, 10:00 en Bogotá.
const AHORA = new Date('2026-10-21T15:00:00Z');

describe('fechas en America/Bogota (§21.1)', () => {
  it('el día cambia a las 05:00 UTC', () => {
    expect(fechaBogota(new Date('2026-10-21T04:59:59.999Z'))).toBe('2026-10-20');
    expect(fechaBogota(new Date('2026-10-21T05:00:00Z'))).toBe('2026-10-21');
    expect(inicioDiaBogotaUtc('2026-10-21').toISOString()).toBe('2026-10-21T05:00:00.000Z');
  });

  it('presets del filtro de fecha', () => {
    expect(rangoPreset('hoy', AHORA)).toEqual({ desde: '2026-10-21', hasta: '2026-10-21' });
    expect(rangoPreset('ayer', AHORA)).toEqual({ desde: '2026-10-20', hasta: '2026-10-20' });
    expect(rangoPreset('ultimos_7_dias', AHORA)).toEqual({ desde: '2026-10-15', hasta: '2026-10-21' });
    expect(rangoPreset('esta_semana', AHORA)).toEqual({ desde: '2026-10-19', hasta: '2026-10-21' });
    expect(rangoPreset('este_mes', AHORA)).toEqual({ desde: '2026-10-01', hasta: '2026-10-21' });
    expect(rangoPreset('mes_anterior', AHORA)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    // Lunes: la semana es solo hoy.
    expect(rangoPreset('esta_semana', new Date('2026-10-19T12:00:00Z'))).toEqual({ desde: '2026-10-19', hasta: '2026-10-19' });
  });

  it('periodo anterior equivalente', () => {
    expect(periodoAnterior({ desde: '2026-10-21', hasta: '2026-10-21' })).toEqual({ desde: '2026-10-20', hasta: '2026-10-20' });
    expect(periodoAnterior({ desde: '2026-10-15', hasta: '2026-10-21' })).toEqual({ desde: '2026-10-08', hasta: '2026-10-14' });
    expect(periodoAnterior({ desde: '2026-10-19', hasta: '2026-10-21' })).toEqual({ desde: '2026-10-16', hasta: '2026-10-18' });
    // Meses: alineado al calendario cuando el filtro es de mes.
    expect(periodoAnterior({ desde: '2026-10-01', hasta: '2026-10-21' }, 'este_mes')).toEqual({ desde: '2026-09-01', hasta: '2026-09-21' });
    expect(periodoAnterior({ desde: '2026-09-01', hasta: '2026-09-30' }, 'mes_anterior')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
    expect(periodoAnterior({ desde: '2026-03-01', hasta: '2026-03-31' }, 'mes_anterior')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(periodoAnterior({ desde: '2028-03-01', hasta: '2028-03-30' }, 'este_mes')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(periodoAnterior({ desde: '2026-01-01', hasta: '2026-01-15' }, 'este_mes')).toEqual({ desde: '2025-12-01', hasta: '2025-12-15' });
    // "Hoy" el día 1 compara con el día anterior, no con el 1 del mes anterior.
    expect(periodoAnterior({ desde: '2026-10-01', hasta: '2026-10-01' }, 'hoy')).toEqual({ desde: '2026-09-30', hasta: '2026-09-30' });
    // Personalizado: misma cantidad de días inmediatamente antes.
    expect(periodoAnterior({ desde: '2026-10-01', hasta: '2026-10-21' })).toEqual({ desde: '2026-09-10', hasta: '2026-09-30' });
  });

  it('diasEntre incluye ambos extremos y valida el rango', () => {
    expect(diasEntre({ desde: '2026-02-27', hasta: '2026-03-02' })).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(() => diasEntre({ desde: '2026-03-02', hasta: '2026-03-01' })).toThrow(RangeError);
    expect(() => diasEntre({ desde: '2026-02-30', hasta: '2026-03-01' })).toThrow(RangeError);
  });
});
