import { describe, expect, it } from 'vitest';
import { enSilencio, planRecordatorios, plantillaRecordatorio } from './plan.js';

const BOGOTA = 'America/Bogota'; // UTC-5, sin horario de verano
const SILENCIO = { inicio: '21:00', fin: '07:00' };
/** Hora local de Bogotá → Date UTC. */
const bog = (iso: string) => new Date(`${iso}-05:00`);
const local = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: BOGOTA, dateStyle: 'short', timeStyle: 'short' }).format(d);

function plan(creadoLocal: string, offsets = [180, 720, 1260], ttlHoras = 24) {
  const creado = bog(creadoLocal);
  return planRecordatorios({
    creado,
    venceEn: new Date(creado.getTime() + ttlHoras * 3_600_000),
    offsetsMinutos: offsets,
    silencio: SILENCIO,
    zona: BOGOTA,
  }).map((r) => ({ n: r.n, en: local(r.enviarEn) }));
}

describe('plan de recordatorios (§13.1, offsets y horario silencioso configurables)', () => {
  it('pedido a las 10:00: 13:00, 22:00 → 07:00 del día siguiente, 07:00 → a tiempo', () => {
    // 10:00 + 3 h = 13:00; + 12 h = 22:00 (silencio → 07:00, quedan 3 h); + 21 h = 07:00 (fuera del silencio).
    // Los dos últimos coinciden a las 07:00: se envía uno solo, el más avanzado (final).
    expect(plan('2026-10-20T10:00:00')).toEqual([
      { n: 1, en: '2026-10-20 13:00' },
      { n: 3, en: '2026-10-21 07:00' },
    ]);
  });

  it('pedido a las 08:00: 11:00, 20:00, 05:00 → 07:00 con 1 h justa de vigencia', () => {
    expect(plan('2026-10-20T08:00:00')).toEqual([
      { n: 1, en: '2026-10-20 11:00' },
      { n: 2, en: '2026-10-20 20:00' },
      { n: 3, en: '2026-10-21 07:00' },
    ]);
  });

  it('pedido a las 19:00: 22:00 → 07:00; 07:00 coincide; 16:00 fuera del silencio', () => {
    expect(plan('2026-10-20T19:00:00')).toEqual([
      { n: 2, en: '2026-10-21 07:00' },
      { n: 3, en: '2026-10-21 16:00' },
    ]);
  });

  it('se omite el que al moverse a las 07:00 queda con menos de 1 h de vigencia', () => {
    // Pedido 06:30 con TTL 1 h y offset 10 min: 06:40 cae en silencio → 07:00, vence 07:30 (< 1 h) → omitido.
    expect(plan('2026-10-20T06:30:00', [10], 1)).toEqual([]);
    // Con TTL 2 h: vence 08:30, quedan 1 h 30 → se envía a las 07:00.
    expect(plan('2026-10-20T06:30:00', [10], 2)).toEqual([{ n: 1, en: '2026-10-20 07:00' }]);
  });

  it('offsets después del vencimiento, negativos, repetidos o no enteros se ignoran', () => {
    expect(plan('2026-10-20T10:00:00', [180, 180, -5, 1.5, 1500])).toEqual([{ n: 1, en: '2026-10-20 13:00' }]);
  });

  it('silencio con inicio = fin desactiva el horario silencioso; silencio diurno también funciona', () => {
    expect(enSilencio(bog('2026-10-20T23:00:00'), { inicio: '00:00', fin: '00:00' }, BOGOTA)).toBe(false);
    expect(enSilencio(bog('2026-10-20T13:00:00'), { inicio: '12:00', fin: '14:00' }, BOGOTA)).toBe(true);
    expect(enSilencio(bog('2026-10-20T14:00:00'), { inicio: '12:00', fin: '14:00' }, BOGOTA)).toBe(false);
    expect(enSilencio(bog('2026-10-20T21:00:00'), SILENCIO, BOGOTA)).toBe(true);
    expect(enSilencio(bog('2026-10-20T06:59:00'), SILENCIO, BOGOTA)).toBe(true);
    expect(enSilencio(bog('2026-10-20T07:00:00'), SILENCIO, BOGOTA)).toBe(false);
  });

  it('hora mal formada lanza (dato del panel)', () => {
    expect(() => enSilencio(new Date(), { inicio: '25:00', fin: '07:00' }, BOGOTA)).toThrow(RangeError);
  });

  it('plantilla por recordatorio: 1 → _1, último → _final, intermedios → _2', () => {
    expect(plantillaRecordatorio(1, 3)).toBe('recordatorio_abono_1');
    expect(plantillaRecordatorio(2, 3)).toBe('recordatorio_abono_2');
    expect(plantillaRecordatorio(3, 3)).toBe('recordatorio_abono_final');
    expect(plantillaRecordatorio(3, 5)).toBe('recordatorio_abono_2');
    expect(plantillaRecordatorio(1, 1)).toBe('recordatorio_abono_final');
  });
});
